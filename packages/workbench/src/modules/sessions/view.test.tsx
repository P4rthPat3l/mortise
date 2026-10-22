// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionListState, SessionsValue } from "./contract"
import { SessionsPanel } from "./view"

afterEach(cleanup)

const service = (state: SessionListState): SessionsValue => ({
  store: { getSnapshot: () => state, subscribe: () => () => {} },
  refresh: () => {},
  select: () => {},
})

describe("BR-003 a failed session fetch is not an empty list", () => {
  it("shows the error and no empty-list message", () => {
    render(<SessionsPanel sessions={service({ status: "error", sessions: [], error: "engine unreachable" })} />)

    expect(screen.getByRole("alert").textContent).toContain("engine unreachable")
    expect(screen.queryByText(/No sessions yet/)).toBeNull()
  })

  it("shows the empty message only for a successful empty read", () => {
    render(<SessionsPanel sessions={service({ status: "ready", sessions: [] })} />)

    expect(screen.getByText(/No sessions yet/)).toBeDefined()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
