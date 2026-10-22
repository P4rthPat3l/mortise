import { messageId, partId, sessionId, type TimelineItem, type ToolCallPart } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { createTimelineStore } from "./timeline.js"

const SESSION = sessionId("ses_1")
const OTHER = sessionId("ses_2")
const ASSISTANT = messageId("msg_a")
const USER = messageId("msg_u")

const text = (id: string, value: string) => ({ kind: "text" as const, id: partId(id), text: value })

const assistant = (parts: TimelineItem["parts"], createdAt = 10): TimelineItem => ({
  kind: "assistant",
  id: ASSISTANT,
  createdAt,
  parts,
})

const user = (createdAt = 5): TimelineItem => ({
  kind: "user",
  id: USER,
  createdAt,
  parts: [text("msg_u:text:0", "hello")],
})

describe("BR-004 timeline store is normalized by session, item and part", () => {
  it("applies an item and its parts", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "one")]) })

    expect(store.itemIds(SESSION)).toEqual([ASSISTANT])
    expect(store.partRefs(SESSION, ASSISTANT)).toEqual([{ id: "a:text:0", kind: "text" }])
    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ kind: "text", text: "one" })
    expect(store.items(SESSION)).toHaveLength(1)
    expect(store.itemIds(OTHER)).toEqual([])
  })

  it("keeps items ordered by creation time", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([], 10) })
    store.apply(SESSION, { type: "item.added", item: user(5) })

    expect(store.itemIds(SESSION)).toEqual([USER, ASSISTANT])
  })

  it("applies text, part replacement and tool patches", () => {
    const store = createTimelineStore()
    const tool: ToolCallPart = {
      kind: "tool",
      id: partId("call_1"),
      callId: "call_1",
      tool: "glob",
      state: "pending",
      input: undefined,
      output: undefined,
    }
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "one"), tool]) })
    store.apply(SESSION, {
      type: "part.text.appended",
      messageId: ASSISTANT,
      partId: partId("a:text:0"),
      delta: " two",
    })
    store.apply(SESSION, {
      type: "part.updated",
      messageId: ASSISTANT,
      part: text("a:text:0", "final"),
    })
    store.apply(SESSION, {
      type: "part.patched",
      messageId: ASSISTANT,
      partId: partId("call_1"),
      patch: { state: "success", output: "done" },
    })

    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ text: "final" })
    expect(store.part(SESSION, partId("call_1"))).toMatchObject({ state: "success", output: "done" })
  })
})

describe("BR-004 only the changed part is notified", () => {
  it("notifies one part and neither item order nor sibling parts on a delta", () => {
    const store = createTimelineStore()
    store.apply(SESSION, {
      type: "item.added",
      item: assistant([text("a:text:0", ""), text("a:text:1", "sibling")]),
    })

    let order = 0
    let refs = 0
    let first = 0
    let sibling = 0
    store.subscribeItemIds(SESSION, () => {
      order += 1
    })
    store.subscribePartRefs(SESSION, ASSISTANT, () => {
      refs += 1
    })
    store.subscribePart(SESSION, partId("a:text:0"), () => {
      first += 1
    })
    store.subscribePart(SESSION, partId("a:text:1"), () => {
      sibling += 1
    })

    for (let index = 0; index < 100; index += 1) {
      store.apply(SESSION, {
        type: "part.text.appended",
        messageId: ASSISTANT,
        partId: partId("a:text:0"),
        delta: "x",
      })
    }

    expect(first).toBe(100)
    expect(order).toBe(0)
    expect(refs).toBe(0)
    expect(sibling).toBe(0)
    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ text: "x".repeat(100) })
  })

  it("notifies item order when a part is added and when an item arrives", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "one")]) })

    let order = 0
    let refs = 0
    store.subscribeItemIds(SESSION, () => {
      order += 1
    })
    store.subscribePartRefs(SESSION, ASSISTANT, () => {
      refs += 1
    })

    store.apply(SESSION, {
      type: "part.added",
      messageId: ASSISTANT,
      part: text("a:text:1", "two"),
    })

    expect(order).toBe(0)
    expect(refs).toBe(1)
    expect(store.partRefs(SESSION, ASSISTANT)).toHaveLength(2)
  })
})

describe("BR-009 unknown targets are ignored", () => {
  it("does not invent an item or a part", () => {
    const store = createTimelineStore()
    store.apply(SESSION, {
      type: "part.text.appended",
      messageId: messageId("missing"),
      partId: partId("missing:text:0"),
      delta: "x",
    })
    store.apply(SESSION, {
      type: "part.added",
      messageId: messageId("missing"),
      part: text("missing:text:0", "x"),
    })
    store.apply(SESSION, {
      type: "part.updated",
      messageId: ASSISTANT,
      part: text("a:text:0", "x"),
    })

    expect(store.itemIds(SESSION)).toEqual([])
    expect(store.part(SESSION, partId("a:text:0"))).toBeUndefined()
  })

  it("ignores a tool patch on a non-tool part", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "one")]) })
    store.apply(SESSION, {
      type: "part.patched",
      messageId: ASSISTANT,
      partId: partId("a:text:0"),
      patch: { state: "success" },
    })

    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ kind: "text", text: "one" })
  })
})

describe("BR-005 batching coalesces notifications", () => {
  it("notifies a part once per batch", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "")]) })
    let notifications = 0
    store.subscribePart(SESSION, partId("a:text:0"), () => {
      notifications += 1
    })

    store.batch(() => {
      for (let index = 0; index < 50; index += 1) {
        store.apply(SESSION, {
          type: "part.text.appended",
          messageId: ASSISTANT,
          partId: partId("a:text:0"),
          delta: "x",
        })
      }
    })

    expect(notifications).toBe(1)
    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ text: "x".repeat(50) })
  })
})

describe("BR-007 resync snapshots", () => {
  it("replaces a session with a snapshot", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "old")]) })

    const next = [user(), assistant([text("a:text:0", "fresh")], 10)]
    store.replace(SESSION, next)

    expect(store.items(SESSION)).toEqual(next)
  })

  it("merges a page, replacing matching items and keeping older ones", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: user() })
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "partial")]) })

    store.merge(SESSION, [assistant([text("a:text:0", "complete")], 10)])

    expect(store.items(SESSION)).toEqual([user(), assistant([text("a:text:0", "complete")], 10)])
    expect(store.part(SESSION, partId("a:text:0"))).toMatchObject({ text: "complete" })
  })

  it("drops a part the snapshot no longer has", () => {
    const store = createTimelineStore()
    store.apply(SESSION, { type: "item.added", item: assistant([text("a:text:0", "one")]) })

    store.merge(SESSION, [assistant([], 10)])

    expect(store.partRefs(SESSION, ASSISTANT)).toEqual([])
    expect(store.part(SESSION, partId("a:text:0"))).toBeUndefined()
  })
})
