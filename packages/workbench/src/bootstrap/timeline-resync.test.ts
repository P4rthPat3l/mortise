/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { createTimelineStore, type TimelineStore } from "@mortise/core"
import { messageId, partId, serverId, sessionId, type TimelineItem, type TimelinePatch } from "@mortise/domain"
import { createAdapter } from "@mortise/engine-opencode"
import { describe, expect, it } from "vitest"

// T-007 recorded these fixtures; the adapter replays them without an engine.
const FIXTURES_ROOT = new URL("../../../engine-opencode/fixtures/", import.meta.url)
const VERSIONS = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const SESSION = sessionId("ses_resync")

const read = (version: string, name: string): string =>
  readFileSync(new URL(`${version}/${name}`, FIXTURES_ROOT), "utf8")

const readPatches = async (version: string): Promise<TimelinePatch[]> => {
  const adapter = createAdapter({
    serverId: serverId("test"),
    baseUrl: "http://engine.test",
    fetch: async () => new Response(null, { status: 500 }),
  })
  return read(version, "events-turn.jsonl")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown)
    .flatMap((wire) => adapter.translate(wire))
    .flatMap((event) => (event.type === "timeline.patch" ? [event.patch] : []))
}

const readSnapshot = async (version: string): Promise<TimelineItem[]> => {
  const raw = read(version, "messages.json")
  const adapter = createAdapter({
    serverId: serverId("test"),
    baseUrl: "http://engine.test",
    fetch: async () => new Response(raw, { status: 200, headers: { "content-type": "application/json" } }),
  })
  return adapter.timeline(SESSION)
}

const applyAll = (store: TimelineStore, patches: readonly TimelinePatch[]): void => {
  store.batch(() => {
    for (const patch of patches) store.apply(SESSION, patch)
  })
}

describe.each(VERSIONS)("AC-001 resync from the recorded turn (%s)", (version) => {
  it("a partial stream plus the fresh page equals a fresh load", async () => {
    const patches = await readPatches(version)
    const snapshot = await readSnapshot(version)
    expect(patches.length).toBeGreaterThan(0)
    expect(snapshot.length).toBeGreaterThan(0)

    const fresh = createTimelineStore()
    fresh.replace(SESSION, snapshot)

    const partial = createTimelineStore()
    applyAll(partial, patches.slice(0, Math.floor(patches.length / 2)))
    partial.merge(SESSION, snapshot)

    expect(partial.items(SESSION)).toEqual(fresh.items(SESSION))
  })

  it("a resync after every delta equals a fresh load", async () => {
    const patches = await readPatches(version)
    const snapshot = await readSnapshot(version)

    const partial = createTimelineStore()
    applyAll(partial, patches)
    partial.merge(SESSION, snapshot)

    const fresh = createTimelineStore()
    fresh.replace(SESSION, snapshot)

    expect(partial.items(SESSION)).toEqual(fresh.items(SESSION))
  })
})

describe("BR-007 resync keeps older loaded items", () => {
  it("merges the latest page without dropping what came before it", async () => {
    const snapshot = await readSnapshot("2.0.26")
    const older: TimelineItem = {
      kind: "user",
      id: messageId("msg_older"),
      createdAt: 0,
      parts: [{ kind: "text", id: partId("msg_older:text:0"), text: "an older prompt" }],
    }
    const store = createTimelineStore()
    store.replace(SESSION, [older])
    store.merge(SESSION, snapshot)

    expect(store.items(SESSION)).toEqual([older, ...snapshot])
  })
})
