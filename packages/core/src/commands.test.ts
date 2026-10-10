import { describe, expect, it, vi } from "vitest"
import { CommandError, CommandService } from "./commands.js"

function captureCommandError(run: () => unknown): CommandError {
  try {
    run()
  } catch (error) {
    if (error instanceof CommandError) return error
    throw error
  }
  throw new Error("expected a CommandError")
}

describe("CommandService", () => {
  it("AC-1: register then execute forwards arguments and resolves the result", async () => {
    const service = new CommandService()
    const run = vi.fn((left: number, right: number) => left + right)
    service.register({ id: "math.add", title: "Add", run })

    await expect(service.execute("math.add", 2, 3)).resolves.toBe(5)
    expect(run).toHaveBeenCalledWith(2, 3)
  })

  it("AC-1: duplicate ids throw a duplicate CommandError", () => {
    const service = new CommandService()
    service.register({ id: "settings.open", title: "Open", run: () => undefined })

    const error = captureCommandError(() =>
      service.register({ id: "settings.open", title: "Open again", run: () => undefined }),
    )
    expect(error.code).toBe("duplicate")
    expect(error.commandId).toBe("settings.open")
  })

  it("AC-1: executing a missing command rejects with not-found", async () => {
    const service = new CommandService()
    await expect(service.execute("missing")).rejects.toMatchObject({ code: "not-found", commandId: "missing" })
  })

  it("AC-1: executing a disabled command rejects with disabled", async () => {
    const service = new CommandService()
    service.register({ id: "review.submit", title: "Submit", enabled: () => false, run: () => undefined })

    await expect(service.execute("review.submit")).rejects.toMatchObject({ code: "disabled" })
  })

  it("AC-1: the register disposable withdraws the command", async () => {
    const service = new CommandService()
    const registration = service.register({ id: "review.open", title: "Open", run: () => undefined })

    registration.dispose()

    await expect(service.execute("review.open")).rejects.toMatchObject({ code: "not-found" })
  })

  it("AC-1: a synchronous throw from run becomes a rejection", async () => {
    const service = new CommandService()
    service.register({
      id: "boom",
      title: "Boom",
      run: () => {
        throw new Error("kaboom")
      },
    })

    await expect(service.execute("boom")).rejects.toThrow("kaboom")
  })

  it("AC-1: list reports id, title and current enabled state", () => {
    const service = new CommandService()
    let enabled = true
    service.register({ id: "a", title: "A", run: () => undefined })
    service.register({ id: "b", title: "B", enabled: () => enabled, run: () => undefined })

    expect(service.list()).toEqual([
      { id: "a", title: "A", enabled: true },
      { id: "b", title: "B", enabled: true },
    ])

    enabled = false
    expect(service.list()[1]).toEqual({ id: "b", title: "B", enabled: false })
  })
})
