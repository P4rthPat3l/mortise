// @vitest-environment happy-dom
import { createStore, createTimelineStore } from "@mortise/core"
import { messageId, partId, projectId, type SessionSummary, sessionId, type TimelineItem } from "@mortise/domain"
import { cleanup, render } from "@testing-library/react"
import { act, Profiler } from "react"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionListState, SessionsValue } from "../modules/sessions/contract"
import { SessionsPanel } from "../modules/sessions/view"
import { TimelineItemView } from "../modules/timeline/item"

const SESSION = sessionId("ses_stream")
const FIRST = messageId("msg_first")
const SIBLING = messageId("msg_sibling")

const summary: SessionSummary = {
  id: SESSION,
  title: "Streaming",
  projectId: projectId("prj_1"),
  directory: "/work",
  createdAt: 1,
  updatedAt: 2,
  activity: "running",
}

const textPart = (id: string, text: string) => ({ kind: "text" as const, id: partId(id), text })

const item = (id: typeof FIRST, textId: string, text: string): TimelineItem => ({
  kind: "assistant",
  id,
  createdAt: 10,
  parts: [textPart(textId, text)],
})

const sessions = (): SessionsValue => {
  const store = createStore<SessionListState>({ status: "ready", sessions: [summary], selectedId: SESSION })
  return { store, refresh: () => {}, select: () => {} }
}

afterEach(cleanup)

describe("AC-002 streaming re-renders one part", () => {
  it("2,000 deltas leave the sibling item and the session list untouched", () => {
    const timeline = createTimelineStore()
    timeline.replace(SESSION, [item(FIRST, "msg_first:text:0", ""), item(SIBLING, "msg_sibling:text:0", "sibling")])

    const counts: Record<string, number> = { streaming: 0, sibling: 0, sessions: 0 }
    const onRender = (id: string) => () => {
      counts[id] = (counts[id] ?? 0) + 1
    }

    const sessionService = sessions()
    render(
      <>
        <Profiler id="sessions" onRender={onRender("sessions")}>
          <SessionsPanel sessions={sessionService} />
        </Profiler>
        <Profiler id="streaming" onRender={onRender("streaming")}>
          <TimelineItemView timeline={timeline} sessionId={SESSION} messageId={FIRST} />
        </Profiler>
        <Profiler id="sibling" onRender={onRender("sibling")}>
          <TimelineItemView timeline={timeline} sessionId={SESSION} messageId={SIBLING} />
        </Profiler>
      </>,
    )

    const baseline = { ...counts }

    for (let frame = 0; frame < 40; frame += 1) {
      act(() => {
        timeline.batch(() => {
          for (let delta = 0; delta < 50; delta += 1) {
            timeline.apply(SESSION, {
              type: "part.text.appended",
              messageId: FIRST,
              partId: partId("msg_first:text:0"),
              delta: "x",
            })
          }
        })
      })
    }

    expect(counts.streaming).toBeGreaterThan(baseline.streaming ?? 0)
    expect(counts.sibling).toBe(baseline.sibling)
    expect(counts.sessions).toBe(baseline.sessions)
    expect(timeline.part(SESSION, partId("msg_first:text:0"))).toMatchObject({ text: "x".repeat(2_000) })
  })
})
