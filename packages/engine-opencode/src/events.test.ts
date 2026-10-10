/// <reference types="node" />
import { readFileSync } from "node:fs"
import type { TimelineItem, TimelinePatch } from "@mortise/domain"
import type { SessionMessagesResponse } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { eventDiagnostics, resetEventDiagnostics, translate } from "./events.js"
import { mapTimeline } from "./timeline.js"

const FIXTURES = new URL("../fixtures/2.0.26/", import.meta.url)

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"))

const readTurn = (): unknown[] =>
  readFileSync(new URL("events-turn.jsonl", FIXTURES), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))

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

describe("translate", () => {
  it("AC-2: the recorded turn reduces to the final message-list timeline", () => {
    const reduced = readTurn()
      .flatMap((wire) => translate(wire))
      .reduce<TimelineItem[]>((items, event) => {
        if (event.type !== "timeline.patch") return items
        return applyPatch(items, event.patch)
      }, [])

    const snapshot = mapTimeline(fixture("messages.json") as SessionMessagesResponse)
    expect(reduced).toEqual(snapshot)
  })

  it("AC-5: an unknown event type is counted, not thrown", () => {
    resetEventDiagnostics()
    expect(translate({ id: "evt_0", created: 1, type: "future.thing", data: {} })).toEqual([])
    expect(eventDiagnostics()).toEqual({ unknownTypes: 1, malformedPayloads: 0 })
  })

  it("AC-5: malformed payloads are counted separately, not thrown", () => {
    resetEventDiagnostics()
    expect(translate(42)).toEqual([])
    expect(translate({ created: 1, data: {} })).toEqual([])
    expect(translate({ type: "session.created", created: 1, data: 42 })).toEqual([])
    expect(eventDiagnostics()).toEqual({ unknownTypes: 0, malformedPayloads: 3 })
  })

  it("known events with no domain home are not counted as unknown", () => {
    resetEventDiagnostics()
    expect(translate({ type: "project.updated", created: 1, data: {} })).toEqual([])
    expect(eventDiagnostics()).toEqual({ unknownTypes: 0, malformedPayloads: 0 })
  })
})

describe("session activity", () => {
  it("derives activity from execution events", () => {
    expect(translate({ type: "session.execution.started", created: 1, data: { sessionID: "ses_1" } })).toEqual([
      { type: "session.activity", sessionId: "ses_1", status: "running" },
    ])
    expect(translate({ type: "session.execution.succeeded", created: 2, data: { sessionID: "ses_1" } })).toEqual([
      { type: "session.activity", sessionId: "ses_1", status: "idle" },
    ])
    expect(translate({ type: "session.retry.scheduled", created: 3, data: { sessionID: "ses_1" } })).toEqual([
      { type: "session.activity", sessionId: "ses_1", status: "retrying" },
    ])
  })
})

describe("requests", () => {
  it("maps permission.asked and permission.replied", () => {
    expect(
      translate({
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
      translate({ type: "permission.replied", created: 112, data: { sessionID: "ses_1", requestID: "per_1" } }),
    ).toEqual([{ type: "request.closed", requestId: "per_1" }])
  })

  it("maps form.created, form.replied and form.cancelled", () => {
    const opened = translate({
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
    expect(translate({ type: "form.replied", created: 223, data: { id: "frm_1", sessionID: "ses_1" } })).toEqual([
      { type: "request.closed", requestId: "frm_1" },
    ])
    expect(translate({ type: "form.cancelled", created: 224, data: { id: "frm_1", sessionID: "ses_1" } })).toEqual([
      { type: "request.closed", requestId: "frm_1" },
    ])
  })
})
