// T-015 spike debug page. This is not product code. It is built only with MORTISE_SPIKE_BUILD=1,
// loaded in a spike-only window, and drives the measurements the research document reports.
//
// The host half of the bridge is here, in the renderer: it accepts only messages whose source is a
// registered iframe, rejects anything not addressed extension-to-host, and answers the three calls
// the spike allows. The sandboxed iframe never gets an object, only postMessage.

import manifest from "../sample-extension/package.json"
import { extensionViewUrl } from "../shared/constants.js"
import {
  EXTENSION_CALLS,
  EXTENSION_RPC_PROTOCOL,
  EXTENSION_RPC_VERSION,
  type ExtensionCallName,
  type ExtensionRequest,
  type ExtensionResponse,
  isExtensionRequest,
} from "../shared/envelope.js"
import { renderToolCall, type ToolRendererContribution } from "./tool-call.js"

interface BridgeStats {
  readonly received: number
  readonly accepted: number
  readonly rejected: Readonly<Record<string, number>>
  readonly calls: Readonly<Record<ExtensionCallName, number>>
}

interface FrameRecord {
  readonly element: HTMLIFrameElement
  ready: boolean
  readonly readyPromise: Promise<void>
  resolveReady: () => void
}

/** The imperative surface the main-process orchestrator calls through executeJavaScript. */
export interface SpikePanelApi {
  setFrameCount(count: number): Promise<{ requested: number; ready: number; timedOut: number; elapsedMs: number }>
  bridgeStats(): BridgeStats
  notifications(): readonly string[]
  registeredCommands(): readonly string[]
  frameCount(): number
}

declare global {
  interface Window {
    __mortiseSpikePanel?: SpikePanelApi
  }
}

const FRAME_READY_TIMEOUT_MS = 5_000

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  return element
}

function tableRenderer(raw: {
  match: string
  title: string
  body: string
  columns: string[]
}): ToolRendererContribution {
  if (raw.body !== "table") throw new Error(`unsupported tool renderer body: ${raw.body}`)
  return { match: raw.match, title: raw.title, body: "table", columns: raw.columns }
}

export function mountPanel(root: HTMLElement): void {
  const frames: FrameRecord[] = []
  const notifications: string[] = []
  const hostLog: string[] = []
  const registered = new Set<string>()
  const rejected: Record<string, number> = {}
  const calls: Record<ExtensionCallName, number> = { "commands.register": 0, notify: 0, "network.fetch": 0 }
  let received = 0
  let accepted = 0

  root.replaceChildren()
  const page = el("main")
  page.className = "spike"
  page.append(
    el("h1", "DEBUG SPIKE: sandboxed extension iframe (T-015)"),
    el("p", "Not a product feature. Built only with MORTISE_SPIKE_BUILD=1 and run only in a non-packaged spike build."),
  )

  const frameBox = el("section")
  frameBox.append(
    el("h2", "Extension frames"),
    el("p", `sandbox="allow-scripts", no allow-same-origin. CSP is served on every file.`),
  )
  const controls = el("div")
  controls.className = "controls"
  for (const count of [1, 5, 10]) {
    const button = el("button", `Load ${count} frame${count === 1 ? "" : "s"}`)
    button.addEventListener("click", () => {
      void setFrameCount(count)
    })
    controls.append(button)
  }
  const frameStatus = el("p", "0 frames")
  frameStatus.className = "status"
  const frameHost = el("div")
  frameHost.className = "frames"
  frameBox.append(controls, frameStatus, frameHost)

  const toolSection = el("section")
  toolSection.append(el("h2", "Declarative tool-call renderer (host-rendered)"))
  const rawRenderer = manifest.mortise.contributes.toolRenderers[0]
  if (rawRenderer === undefined) throw new Error("the sample manifest has no tool renderer")
  const renderer = tableRenderer(rawRenderer)
  const view = renderToolCall(renderer, {
    name: "mcp.acme.tasks",
    input: { id: "T-42", title: "Ship the sandbox spike", status: "open" },
  })
  const toolTable = el("table")
  const head = el("tr")
  for (const column of view.columns) head.append(el("th", column))
  toolTable.append(head)
  for (const row of view.rows) {
    const tr = el("tr")
    for (const cell of row) tr.append(el("td", cell))
    toolTable.append(tr)
  }
  toolSection.append(el("p", `title template renders "${view.title}"; matched "${renderer.match}"`), toolTable)

  const logSection = el("section")
  logSection.append(el("h2", "Host log"))
  const logList = el("ul")
  logList.className = "log"
  logSection.append(logList)

  page.append(frameBox, toolSection, logSection)
  root.append(page)

  function writeLog(message: string): void {
    hostLog.push(message)
    const item = el("li", message)
    logList.append(item)
    while (logList.childElementCount > 50) logList.firstElementChild?.remove()
  }

  function reject(reason: string): void {
    rejected[reason] = (rejected[reason] ?? 0) + 1
  }

  function send(record: FrameRecord, message: ExtensionResponse): void {
    record.element.contentWindow?.postMessage(message, "*")
  }

  function respondError(record: FrameRecord, message: ExtensionRequest, code: string, text: string): void {
    send(record, {
      protocol: EXTENSION_RPC_PROTOCOL,
      version: EXTENSION_RPC_VERSION,
      direction: "host-to-extension",
      id: message.id,
      kind: "response",
      ok: false,
      error: { code, message: text },
    })
  }

  function respondResult(record: FrameRecord, message: ExtensionRequest, result: unknown): void {
    send(record, {
      protocol: EXTENSION_RPC_PROTOCOL,
      version: EXTENSION_RPC_VERSION,
      direction: "host-to-extension",
      id: message.id,
      kind: "response",
      ok: true,
      result,
    })
  }

  function markReady(record: FrameRecord): void {
    if (record.ready) return
    record.ready = true
    record.resolveReady()
    updateFrameStatus()
  }

  // Identity is the only trustworthy thing about a message source. It cannot be forged by page
  // JavaScript, unlike origin, a token or any field in the payload.
  function frameOf(source: unknown): FrameRecord | undefined {
    return frames.find((frame) => frame.element.contentWindow === source)
  }

  function handleMessage(event: MessageEvent): void {
    const data: unknown = event.data
    if (typeof data !== "object" || data === null) return
    if (!("protocol" in data) || data.protocol !== EXTENSION_RPC_PROTOCOL) return
    received += 1
    if (event.source === null) {
      reject("bad-source")
      return
    }
    const record = frameOf(event.source)
    if (record === undefined) {
      reject("unregistered-source")
      return
    }
    if (!isExtensionRequest(data)) {
      const claimedDirection = "direction" in data ? data.direction : undefined
      if (claimedDirection !== "extension-to-host") reject("wrong-direction")
      else reject("invalid-envelope")
      return
    }
    if (!EXTENSION_CALLS.includes(data.call)) {
      reject("unknown-call")
      return
    }

    const params = data.params
    if (data.call === "commands.register") {
      const id = params.id
      const title = params.title
      if (typeof id !== "string" || typeof title !== "string" || id.length === 0) {
        reject("invalid-params")
        respondError(record, data, "invalid_params", "commands.register needs id and title")
        return
      }
      calls["commands.register"] += 1
      accepted += 1
      registered.add(id)
      markReady(record)
      respondResult(record, data, { registered: true, id })
      writeLog(`commands.register ${id} "${title}"`)
      return
    }

    if (data.call === "notify") {
      const kind = params.kind
      const text = params.message
      if (
        (kind !== "info" && kind !== "warning" && kind !== "error") ||
        typeof text !== "string" ||
        text.length > 500
      ) {
        reject("invalid-params")
        respondError(record, data, "invalid_params", "notify needs kind and message")
        return
      }
      calls.notify += 1
      accepted += 1
      notifications.push(`${kind}: ${text}`)
      while (notifications.length > 50) notifications.shift()
      if (text === "view:ready") markReady(record)
      respondResult(record, data, { shown: true })
      return
    }

    if (data.call === "network.fetch") {
      const url = params.url
      if (typeof url !== "string") {
        reject("invalid-params")
        respondError(record, data, "invalid_params", "network.fetch needs a url")
        return
      }
      calls["network.fetch"] += 1
      accepted += 1
      // No network capability was granted, so the host never performs the request.
      respondError(record, data, "capability_denied", "network capability is not granted")
      writeLog(`network.fetch denied for ${url}`)
    }
  }

  function updateFrameStatus(): void {
    const ready = frames.filter((frame) => frame.ready).length
    frameStatus.textContent = `${frames.length} frame${frames.length === 1 ? "" : "s"}, ${ready} ready`
  }

  function createFrame(): FrameRecord {
    const element = document.createElement("iframe")
    element.setAttribute("sandbox", "allow-scripts")
    element.className = "extension-frame"
    element.src = extensionViewUrl()
    let resolveReady: () => void = () => {}
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const record: FrameRecord = { element, ready: false, readyPromise, resolveReady }
    frameHost.append(element)
    return record
  }

  function waitForReady(record: FrameRecord): Promise<"ready" | "timeout"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), FRAME_READY_TIMEOUT_MS)
      void record.readyPromise.then(() => {
        clearTimeout(timer)
        resolve("ready")
      })
    })
  }

  async function setFrameCount(count: number): Promise<{
    requested: number
    ready: number
    timedOut: number
    elapsedMs: number
  }> {
    const started = performance.now()
    while (frames.length > count) {
      frames.pop()?.element.remove()
    }
    const waits: Promise<"ready" | "timeout">[] = []
    while (frames.length < count) {
      const record = createFrame()
      frames.push(record)
      waits.push(waitForReady(record))
    }
    const outcomes = await Promise.all(waits)
    updateFrameStatus()
    const timedOut = outcomes.filter((outcome) => outcome === "timeout").length
    return {
      requested: count,
      ready: count - timedOut,
      timedOut,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    }
  }

  window.addEventListener("message", handleMessage)

  const api: SpikePanelApi = {
    setFrameCount,
    bridgeStats: () => ({ received, accepted, rejected: { ...rejected }, calls: { ...calls } }),
    notifications: () => [...notifications],
    registeredCommands: () => [...registered],
    frameCount: () => frames.length,
  }
  window.__mortiseSpikePanel = api
  writeLog("spike panel ready")
}
