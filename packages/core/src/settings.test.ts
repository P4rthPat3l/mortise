import { describe, expect, it, vi } from "vitest"
import { type SettingSchema, SettingsService } from "./settings.js"

const fontSize: SettingSchema<number> = {
  id: "fonts.size",
  default: 12,
  validate: (value): value is number => typeof value === "number",
}

describe("SettingsService", () => {
  it("AC-1: get returns the schema default before anything is set", () => {
    const settings = new SettingsService()
    settings.register(fontSize)
    expect(settings.get(fontSize)).toBe(12)
  })

  it("AC-1: resolves project over user over default", () => {
    const settings = new SettingsService()
    settings.register(fontSize)

    settings.set(fontSize, 14, "user")
    expect(settings.get(fontSize)).toBe(14)

    settings.set(fontSize, 16, "project")
    expect(settings.get(fontSize)).toBe(16)
  })

  it("AC-1: set validates and rejects an invalid value", () => {
    const settings = new SettingsService()
    settings.register(fontSize)

    expect(() => settings.set(fontSize, "big", "user")).toThrow(/Invalid/)
    expect(settings.get(fontSize)).toBe(12)
  })

  it("AC-1: onChange fires only when the resolved value changes", () => {
    const settings = new SettingsService()
    settings.register(fontSize)
    const change = vi.fn()
    const subscription = settings.onChange(fontSize, change)

    settings.set(fontSize, 14, "user")
    expect(change).toHaveBeenLastCalledWith(14)

    settings.set(fontSize, 14, "user")
    expect(change).toHaveBeenCalledTimes(1)

    settings.set(fontSize, 14, "project")
    expect(change).toHaveBeenCalledTimes(1)

    settings.set(fontSize, 16, "project")
    expect(change).toHaveBeenCalledTimes(2)

    subscription.dispose()
    settings.set(fontSize, 18, "project")
    expect(change).toHaveBeenCalledTimes(2)
  })

  it("AC-1: a listener removed during notification is not called", () => {
    const settings = new SettingsService()
    settings.register(fontSize)
    const first = vi.fn()
    const second = vi.fn()
    let secondSubscription: { dispose(): void } | undefined
    settings.onChange(fontSize, () => {
      first()
      secondSubscription?.dispose()
    })
    secondSubscription = settings.onChange(fontSize, second)

    settings.set(fontSize, 20, "user")

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it("AC-1: a null value is a value, not an unset layer", () => {
    const settings = new SettingsService()
    const nullable: SettingSchema<number | null> = {
      id: "nullable",
      default: null,
      validate: (value): value is number | null => value === null || typeof value === "number",
    }
    settings.register(nullable)

    expect(settings.get(nullable)).toBeNull()
    settings.set(nullable, 5, "user")
    expect(settings.get(nullable)).toBe(5)
    settings.set(nullable, null, "user")
    expect(settings.get(nullable)).toBeNull()
  })

  it("AC-1: register rejects a duplicate id and its disposable removes the schema", () => {
    const settings = new SettingsService()
    const duplicate: SettingSchema<number> = {
      id: "fonts.size",
      default: 10,
      validate: (value): value is number => typeof value === "number",
    }

    const registration = settings.register(fontSize)
    expect(() => settings.register(duplicate)).toThrow(/already registered/)

    registration.dispose()
    expect(() => settings.get(fontSize)).toThrow(/Unknown/)
  })

  it("AC-1: an unregistered schema throws", () => {
    const settings = new SettingsService()
    expect(() => settings.get(fontSize)).toThrow(/Unknown/)
    expect(() => settings.set(fontSize, 1, "user")).toThrow(/Unknown/)
  })
})
