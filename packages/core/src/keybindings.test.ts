import { describe, expect, it } from "vitest"
import { Keybindings, type KeyEvent, parseKeybinding } from "./keybindings.js"

function key(keyName: string, modifiers: Partial<Omit<KeyEvent, "key">> = {}): KeyEvent {
  return { key: keyName, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }
}

describe("parseKeybinding", () => {
  it("AC-3: parses modifiers and a key in any modifier order", () => {
    const binding = parseKeybinding("shift+mod+t")
    expect(binding.source).toBe("shift+mod+t")
    expect(binding.chords).toEqual([{ key: "t", mod: true, ctrl: false, meta: false, alt: false, shift: true }])
  })

  it("AC-3: parses a two-step chord", () => {
    const binding = parseKeybinding("mod+k mod+s")
    expect(binding.chords.map((chord) => chord.key)).toEqual(["k", "s"])
    expect(binding.chords).toHaveLength(2)
  })

  it("AC-3: rejects malformed bindings", () => {
    expect(() => parseKeybinding("")).toThrow()
    expect(() => parseKeybinding("mod+shift")).toThrow()
    expect(() => parseKeybinding("nope+t")).toThrow()
    expect(() => parseKeybinding("a b c")).toThrow()
  })
})

describe("Keybindings", () => {
  it("AC-3: mod is meta on macOS", () => {
    const bindings = new Keybindings("macos")
    bindings.register("editor.save", "mod+t")

    expect(bindings.resolve(key("t", { metaKey: true }))).toBe("editor.save")
    expect(bindings.resolve(key("t", { ctrlKey: true }))).toBeUndefined()
  })

  it("AC-3: mod is control on Linux and Windows", () => {
    const linux = new Keybindings("linux")
    const windows = new Keybindings("windows")
    linux.register("editor.save", "mod+t")
    windows.register("editor.save", "mod+t")

    expect(linux.resolve(key("t", { ctrlKey: true }))).toBe("editor.save")
    expect(linux.resolve(key("t", { metaKey: true }))).toBeUndefined()
    expect(windows.resolve(key("t", { ctrlKey: true }))).toBe("editor.save")
  })

  it("AC-3: modifiers must match exactly", () => {
    const bindings = new Keybindings("linux")
    bindings.register("editor.save", "mod+shift+t")

    expect(bindings.resolve(key("t", { ctrlKey: true }))).toBeUndefined()
    expect(bindings.resolve(key("t", { ctrlKey: true, shiftKey: true }))).toBe("editor.save")
  })

  it("AC-3: a two-step chord arms on the first key and completes on the second", () => {
    const bindings = new Keybindings("linux")
    bindings.register("editor.saveAll", "mod+k mod+s")

    expect(bindings.resolve(key("k", { ctrlKey: true }))).toBeUndefined()
    expect(bindings.resolve(key("s", { ctrlKey: true }))).toBe("editor.saveAll")
  })

  it("AC-3: a wrong second key clears the chord and can start a new binding", () => {
    const bindings = new Keybindings("linux")
    bindings.register("editor.saveAll", "mod+k mod+s")
    bindings.register("editor.open", "mod+o")

    expect(bindings.resolve(key("k", { ctrlKey: true }))).toBeUndefined()
    expect(bindings.resolve(key("o", { ctrlKey: true }))).toBe("editor.open")
  })

  it("AC-3: reset drops an armed chord", () => {
    const bindings = new Keybindings("linux")
    bindings.register("editor.saveAll", "mod+k mod+s")

    bindings.resolve(key("k", { ctrlKey: true }))
    bindings.reset()
    expect(bindings.resolve(key("s", { ctrlKey: true }))).toBeUndefined()
  })

  it("AC-3: conflicts lists distinct commands on the same binding, mod resolved per platform", () => {
    const linux = new Keybindings("linux")
    linux.register("a", "mod+t")
    linux.register("b", "ctrl+t")
    expect(linux.conflicts()).toEqual([{ binding: "ctrl+t", commandIds: ["a", "b"] }])

    const macos = new Keybindings("macos")
    macos.register("a", "mod+t")
    macos.register("b", "ctrl+t")
    expect(macos.conflicts()).toEqual([])
  })

  it("AC-3: the register disposable removes the binding", () => {
    const bindings = new Keybindings("linux")
    const registration = bindings.register("editor.save", "mod+t")

    registration.dispose()

    expect(bindings.resolve(key("t", { ctrlKey: true }))).toBeUndefined()
  })
})
