// Resync correctness for the adapter (FEAT-001 §P2, §BR-018, §AC-005): after the event stream is
// dropped mid-turn and after the engine is restarted, the adapter rebuilds the same session
// timeline as a fresh load. Skipped unless MORTISE_INTEGRATION=1. The deterministic scripted
// provider from T-007 runs the turn; no model or network.
import { type SessionId, serverId, type TimelineItem } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { resolveInstalledBinary, type Sandbox, startSandbox } from "../../../scripts/engine-sandbox.js"
import { fakeProviderConfig, startFakeProvider } from "../../../scripts/fake-provider.js"
import { createAdapter, type EngineAdapter, newMessageId } from "./index.js"

const SERVER = serverId("server-resync")
const TURN_TEXT = "List the text files in the working directory."
const FINAL_TEXT = "Sandbox turn complete."

function sandboxBinary(): "installed" | "bunx" {
  return resolveInstalledBinary() === undefined ? "bunx" : "installed"
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

/** A fetch that authenticates like the gateway transport does in production. */
function authFetch(password: string): typeof globalThis.fetch {
  const authorization = basicAuth(password)
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set("authorization", authorization)
    return fetch(input, { ...init, headers })
  }
}

function adapterFor(sandbox: Sandbox): EngineAdapter {
  return createAdapter({ serverId: SERVER, baseUrl: sandbox.url, fetch: authFetch(sandbox.password) })
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${message}`)
}

function finalText(item: TimelineItem): string | undefined {
  if (item.kind !== "assistant") return undefined
  const texts = item.parts.filter((part) => part.kind === "text").map((part) => part.text)
  return texts.find((text) => text.includes(FINAL_TEXT))
}

async function runTurn(adapter: EngineAdapter): Promise<SessionId> {
  const session = await adapter.createSession({ title: "resync" })
  await adapter.prompt({ sessionId: session.id, text: TURN_TEXT, clientMessageId: newMessageId() })
  await waitFor(
    async () => (await adapter.timeline(session.id)).some((item) => finalText(item) !== undefined),
    60_000,
    "the turn's final assistant text",
  )
  return session.id
}

/**
 * Subscribes to the raw `/api/event` stream. `firstEvent` resolves once one event for `sessionID`
 * has arrived, so the test can drop the connection mid-turn; `abort` closes it.
 */
async function openEventStream(
  sandbox: Sandbox,
  sessionID: string,
): Promise<{ readonly firstEvent: Promise<void>; readonly abort: () => void }> {
  const controller = new AbortController()
  const response = await fetch(`${sandbox.url}/api/event`, {
    headers: { authorization: basicAuth(sandbox.password), accept: "text/event-stream" },
    signal: controller.signal,
  })
  if (response.body === null) throw new Error("event stream had no body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let resolveFirst: () => void = () => {}
  const firstEvent = new Promise<void>((resolve) => {
    resolveFirst = resolve
  })
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffer += decoder.decode(chunk.value, { stream: true })
        for (;;) {
          const end = buffer.indexOf("\n\n")
          if (end === -1) break
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const line = frame.split("\n").find((entry) => entry.startsWith("data:"))
          if (line === undefined) continue
          const event = JSON.parse(line.slice("data:".length).trim()) as {
            readonly data?: { readonly sessionID?: unknown }
          }
          if (event.data?.sessionID === sessionID) resolveFirst()
        }
      }
    } catch {
      // The abort below ends the read; nothing left to observe.
    }
  })()
  return { firstEvent, abort: () => controller.abort() }
}

describe.skipIf(!process.env.MORTISE_INTEGRATION)("FEAT-001 adapter resync", () => {
  it("BR-018 / P2: a stream dropped mid-turn does not change the rebuilt timeline", async () => {
    const provider = await startFakeProvider()
    const sandbox = await startSandbox({ binary: sandboxBinary(), config: fakeProviderConfig(provider.url) })
    try {
      const adapter = adapterFor(sandbox)
      const session = await adapter.createSession({ title: "resync" })
      const stream = await openEventStream(sandbox, session.id)
      try {
        await adapter.prompt({ sessionId: session.id, text: TURN_TEXT, clientMessageId: newMessageId() })
        // Wait for the first event of the turn, then drop the subscriber mid-turn.
        await stream.firstEvent
      } finally {
        stream.abort()
      }
      await waitFor(
        async () => (await adapter.timeline(session.id)).some((item) => finalText(item) !== undefined),
        60_000,
        "the turn's final assistant text",
      )
      const rebuilt = await adapter.timeline(session.id)
      const fresh = await adapterFor(sandbox).timeline(session.id)
      expect(rebuilt).toEqual(fresh)
      expect(rebuilt.some((item) => finalText(item) !== undefined)).toBe(true)
    } finally {
      await sandbox.dispose()
      await provider.stop()
    }
  })

  it("BR-018 / P2: a restarted engine rebuilds the same timeline from the same database", async () => {
    const provider = await startFakeProvider()
    const sandbox = await startSandbox({ binary: sandboxBinary(), config: fakeProviderConfig(provider.url) })
    let restarted: Sandbox | undefined
    try {
      const session = await runTurn(adapterFor(sandbox))
      const baseline = await adapterFor(sandbox).timeline(session)
      expect(baseline.some((item) => finalText(item) !== undefined)).toBe(true)

      await sandbox.stop()
      restarted = await startSandbox({ binary: sandboxBinary(), reuse: sandbox.dirs })
      const rebuilt = await adapterFor(restarted).timeline(session)
      expect(rebuilt).toEqual(baseline)
    } finally {
      await restarted?.dispose()
      await sandbox.dispose()
      await provider.stop()
    }
  })
})
