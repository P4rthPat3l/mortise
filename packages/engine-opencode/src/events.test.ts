/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { serverId, type TimelineItem, type TimelinePatch } from "@mortise/domain"
import type { SessionMessagesResponse } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { createAdapter, type EngineAdapter } from "./adapter.js"
import { mapTimeline } from "./timeline.js"

// One contract run per recorded engine version (T-014).
const FIXTURES_ROOT = new URL("../fixtures/", import.meta.url)
const VERSIONS = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

/** Every file a recording writes. The integrity test fails if one is missing. */
const RECORDED_FILES = [
  "info.json",
  "openapi.json",
  "session-create.json",
  "session-get.json",
  "sessions-list.json",
  "messages.json",
  "events-turn.jsonl",
  "README.md",
] as const

const fixture = (version: string, name: string): unknown =>
  JSON.parse(readFileSync(new URL(`${version}/${name}`, FIXTURES_ROOT), "utf8"))

const readTurn = (version: string): unknown[] =>
  readFileSync(new URL(`${version}/events-turn.jsonl`, FIXTURES_ROOT), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))

/** A fresh adapter owns fresh counters; tests never share diagnostic state. */
const freshAdapter = (): EngineAdapter =>
  createAdapter({
    serverId: serverId("test"),
    baseUrl: "http://engine.test",
    fetch: async () => new Response(null, { status: 500 }),
  })

const applyPatch = (items: TimelineItem[], patch: TimelinePatch): TimelineItem[] => {
  switch (patch.type) {
    case "item.added":
      return [...items, patch.item]
    case "item.patched":
      return items.map((item) => (item.id === patch.messageId ? { ...item, createdAt: patch.createdAt } : item))
    case "item.removed":
      return items.filter((item) => item.id !== patch.messageId)
    case "part.added":
      return items.map((item) => (item.id === patch.messageId ? { ...item, parts: [...item.parts, patch.part] } : item))
    case "part.text.appended":
      return items.map((item) =>
        item.id === patch.messageId
          ? {
              ...item,
              parts: item.parts.map((part) =>
                part.id === patch.partId && (part.kind === "text" || part.kind === "reasoning")
                  ? { ...part, text: part.text + patch.delta }
                  : part,
              ),
            }
          : item,
      )
    case "part.updated":
      return items.map((item) =>
        item.id === patch.messageId
          ? { ...item, parts: item.parts.map((part) => (part.id === patch.part.id ? patch.part : part)) }
          : item,
      )
    case "part.patched":
      return items.map((item) =>
        item.id === patch.messageId
          ? {
              ...item,
              parts: item.parts.map((part) =>
                part.id === patch.partId && part.kind === "tool" ? { ...part, ...patch.patch } : part,
              ),
            }
          : item,
      )
  }
}

describe("contract fixtures", () => {
  it("record every supported engine version", () => {
    expect(VERSIONS).toEqual(expect.arrayContaining(["2.0.20", "2.0.26"]))
  })

  it("AC-4: contain no absolute home directory path", () => {
    for (const version of VERSIONS) {
      for (const name of RECORDED_FILES) {
        const contents = readFileSync(new URL(`${version}/${name}`, FIXTURES_ROOT), "utf8")
        expect(contents, `${version}/${name}`).not.toContain("/home/")
      }
    }
  })
})

describe.each(VERSIONS)("recorded turn (%s)", (version) => {
  it("AC-2: the recorded turn reduces to the final message-list timeline", () => {
    const adapter = freshAdapter()
    const reduced = readTurn(version)
      .flatMap((wire) => adapter.translate(wire))
      .reduce<TimelineItem[]>((items, event) => {
        if (event.type !== "timeline.patch") return items
        return applyPatch(items, event.patch)
      }, [])

    const snapshot = mapTimeline(fixture(version, "messages.json") as SessionMessagesResponse)
    expect(reduced).toEqual(snapshot)
  })
})

describe("translate", () => {
  it("BR-010 / AC-5: an unknown event type is counted, not thrown", () => {
    const adapter = freshAdapter()
    expect(adapter.translate({ id: "evt_0", created: 1, type: "future.thing", data: {} })).toEqual([])
    expect(adapter.diagnostics()).toEqual({ unknownTypes: 1, malformedPayloads: 0 })
  })

  it("BR-010 / AC-5: malformed payloads are counted separately, not thrown", () => {
    const adapter = freshAdapter()
    expect(adapter.translate(42)).toEqual([])
    expect(adapter.translate({ created: 1, data: {} })).toEqual([])
    expect(adapter.translate({ type: "session.created", created: 1, data: 42 })).toEqual([])
    expect(adapter.diagnostics()).toEqual({ unknownTypes: 0, malformedPayloads: 3 })
  })

  it("BR-010: a fresh adapter starts its counters at zero", () => {
    const first = freshAdapter()
    first.translate({ type: "future.thing", created: 1, data: {} })
    expect(first.diagnostics()).toEqual({ unknownTypes: 1, malformedPayloads: 0 })
    expect(freshAdapter().diagnostics()).toEqual({ unknownTypes: 0, malformedPayloads: 0 })
  })

  it("known events with no domain home are not counted as unknown", () => {
    const adapter = freshAdapter()
    expect(adapter.translate({ type: "project.updated", created: 1, data: {} })).toEqual([])
    expect(adapter.diagnostics()).toEqual({ unknownTypes: 0, malformedPayloads: 0 })
  })
})

describe("session activity", () => {
  it("derives activity from execution events", () => {
    const adapter = freshAdapter()
    expect(adapter.translate({ type: "session.execution.started", created: 1, data: { sessionID: "ses_1" } })).toEqual([
      { type: "session.activity", sessionId: "ses_1", status: "running" },
    ])
    expect(
      adapter.translate({ type: "session.execution.succeeded", created: 2, data: { sessionID: "ses_1" } }),
    ).toEqual([{ type: "session.activity", sessionId: "ses_1", status: "idle" }])
    expect(adapter.translate({ type: "session.retry.scheduled", created: 3, data: { sessionID: "ses_1" } })).toEqual([
      { type: "session.activity", sessionId: "ses_1", status: "retrying" },
    ])
  })
})

describe("requests", () => {
  it("maps permission.asked and permission.replied", () => {
    const adapter = freshAdapter()
    expect(
      adapter.translate({
        id: "evt_1",
        created: 111,
        type: "permission.asked",
        data: { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["/etc"] },
      }),
    ).toEqual([
      {
        type: "request.opened",
        request: {
          kind: "permission",
          id: "per_1",
          sessionId: "ses_1",
          title: "bash",
          detail: "/etc",
          createdAt: 111,
        },
      },
    ])
    expect(
      adapter.translate({ type: "permission.replied", created: 112, data: { sessionID: "ses_1", requestID: "per_1" } }),
    ).toEqual([{ type: "request.closed", requestId: "per_1" }])
  })

  it("maps form.created, form.replied and form.cancelled", () => {
    const adapter = freshAdapter()
    const opened = adapter.translate({
      id: "evt_2",
      created: 222,
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Setup",
          fields: [
            { key: "name", type: "string", title: "Name" },
            { key: "env", type: "multiselect", options: [{ value: "x", label: "X" }] },
            { key: "login", type: "external", url: "https://example.com" },
          ],
        },
      },
    })
    expect(opened).toEqual([
      {
        type: "request.opened",
        request: {
          kind: "form",
          id: "frm_1",
          sessionId: "ses_1",
          title: "Setup",
          createdAt: 222,
          questions: [
            { key: "name", type: "string", title: "Name" },
            { key: "env", type: "multiselect", options: [{ value: "x", label: "X" }] },
            { key: "login", type: "external", url: "https://example.com" },
          ],
        },
      },
    ])
    expect(
      adapter.translate({ type: "form.replied", created: 223, data: { id: "frm_1", sessionID: "ses_1" } }),
    ).toEqual([{ type: "request.closed", requestId: "frm_1" }])
    expect(
      adapter.translate({ type: "form.cancelled", created: 224, data: { id: "frm_1", sessionID: "ses_1" } }),
    ).toEqual([{ type: "request.closed", requestId: "frm_1" }])
  })
})
