import { describe, expect, it } from "vitest"
import { newMessageId } from "./ids.js"

describe("newMessageId", () => {
  it("BR-003: has the OpenCode 26-character time-ordered format", () => {
    const id = newMessageId(1_791_640_267_352)
    expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(id).toHaveLength(30)
  })

  it("AC-3: sorts in creation order within one millisecond", () => {
    const first = newMessageId(1_000)
    const second = newMessageId(1_000)
    const third = newMessageId(1_000)
    expect(first < second).toBe(true)
    expect(second < third).toBe(true)
    expect([third, second, first].sort()).toEqual([first, second, third])
  })

  it("AC-3: sorts across milliseconds", () => {
    const earlier = newMessageId(1_000)
    const later = newMessageId(1_001)
    expect(earlier < later).toBe(true)
  })
})
