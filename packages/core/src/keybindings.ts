import { createDisposable, type Disposable } from "./disposable.js"

/** The platforms whose modifier convention the resolver applies. */
export type Platform = "macos" | "linux" | "windows"

/** The fields the resolver reads from a key event, named as the DOM names them. */
export interface KeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/** One key press in a binding. `mod` is the platform's primary modifier. */
export interface Chord {
  readonly key: string
  readonly mod: boolean
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
}

/** A parsed binding: one chord, or two chords to press in sequence. */
export interface Keybinding {
  /** The original text, for diagnostics. */
  readonly source: string
  readonly chords: readonly Chord[]
}

/** Distinct commands bound to the same chord sequence. */
export interface KeybindingConflict {
  /** The binding text, canonicalized per platform. */
  readonly binding: string
  readonly commandIds: readonly string[]
}

const MODIFIERS = {
  mod: "mod",
  ctrl: "ctrl",
  control: "ctrl",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
  alt: "alt",
  option: "alt",
  shift: "shift",
} as const

interface Registered {
  readonly commandId: string
  readonly binding: Keybinding
}

/**
 * Resolves framework-free key events to command ids and reports colliding bindings. A two-chord
 * binding arms after its first key and completes on the second; a single-chord binding always wins
 * over a chord that shares its first key.
 */
export class Keybindings {
  private readonly bindings: Registered[] = []
  private pending: Chord | undefined

  constructor(private readonly platform: Platform) {}

  /**
   * Binds a command to a binding such as `"mod+shift+t"` or `"mod+k mod+s"`. Throws on malformed
   * input. The returned disposable removes the binding.
   */
  register(commandId: string, source: string): Disposable {
    const entry: Registered = { commandId, binding: parseKeybinding(source) }
    this.bindings.push(entry)
    return createDisposable(() => {
      const index = this.bindings.indexOf(entry)
      if (index !== -1) this.bindings.splice(index, 1)
    })
  }

  /**
   * Feeds one key event to the resolver. Returns the command id when a binding completes,
   * otherwise undefined. Clears a pending chord before starting a new one.
   */
  resolve(event: KeyEvent): string | undefined {
    const pressed = chordFromEvent(event)

    if (this.pending) {
      const first = this.pending
      this.pending = undefined
      const completed = this.bindings.find(
        (entry) =>
          entry.binding.chords.length === 2 &&
          chordMatches(entry.binding.chords[0], first, this.platform) &&
          chordMatches(entry.binding.chords[1], pressed, this.platform),
      )
      if (completed) return completed.commandId
    }

    const single = this.bindings.find(
      (entry) => entry.binding.chords.length === 1 && chordMatches(entry.binding.chords[0], pressed, this.platform),
    )
    if (single) return single.commandId

    const start = this.bindings.find(
      (entry) => entry.binding.chords.length === 2 && chordMatches(entry.binding.chords[0], pressed, this.platform),
    )
    if (start) {
      this.pending = pressed
      return undefined
    }

    return undefined
  }

  /** Drops an armed chord, for example when the window loses focus. */
  reset(): void {
    this.pending = undefined
  }

  /** Bindings that two or more distinct commands share, canonicalized per platform. */
  conflicts(): readonly KeybindingConflict[] {
    const groups = new Map<string, Set<string>>()
    for (const { commandId, binding } of this.bindings) {
      const key = binding.chords.map((chord) => this.canonical(chord)).join(" ")
      const commandIds = groups.get(key) ?? new Set<string>()
      commandIds.add(commandId)
      groups.set(key, commandIds)
    }
    const result: KeybindingConflict[] = []
    for (const [binding, commandIds] of groups) {
      if (commandIds.size > 1) result.push({ binding, commandIds: [...commandIds] })
    }
    return result
  }

  private canonical(chord: Chord): string {
    const ctrl = chord.ctrl || (chord.mod && this.platform !== "macos")
    const meta = chord.meta || (chord.mod && this.platform === "macos")
    const parts: string[] = []
    if (ctrl) parts.push("ctrl")
    if (meta) parts.push("meta")
    if (chord.alt) parts.push("alt")
    if (chord.shift) parts.push("shift")
    parts.push(chord.key)
    return parts.join("+")
  }
}

/** Parses `"mod+shift+t"` or `"mod+k mod+s"`. Throws on malformed input. */
export function parseKeybinding(source: string): Keybinding {
  const steps = source
    .trim()
    .split(/\s+/)
    .filter((step) => step.length > 0)
  if (steps.length === 0 || steps.length > 2) {
    throw new Error(`Invalid keybinding "${source}": expected one or two chords`)
  }
  return { source, chords: steps.map((step) => parseChord(step, source)) }
}

function parseChord(step: string, source: string): Chord {
  const tokens = step.toLowerCase().split("+")
  const key = tokens.at(-1)
  if (!key) throw new Error(`Invalid keybinding "${source}": missing key`)
  const flags = { mod: false, ctrl: false, meta: false, alt: false, shift: false }
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIERS[token as keyof typeof MODIFIERS]
    if (!modifier) throw new Error(`Invalid keybinding "${source}": unknown modifier "${token}"`)
    flags[modifier] = true
  }
  if (isModifier(key)) throw new Error(`Invalid keybinding "${source}": "${key}" is a modifier, not a key`)
  return { key, ...flags }
}

function isModifier(token: string): boolean {
  return token in MODIFIERS
}

function chordFromEvent(event: KeyEvent): Chord {
  return {
    key: event.key.toLowerCase(),
    mod: false,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  }
}

function chordMatches(binding: Chord | undefined, pressed: Chord, platform: Platform): boolean {
  if (!binding) return false
  const ctrl = binding.ctrl || (binding.mod && platform !== "macos")
  const meta = binding.meta || (binding.mod && platform === "macos")
  return (
    binding.key === pressed.key &&
    ctrl === pressed.ctrl &&
    meta === pressed.meta &&
    binding.alt === pressed.alt &&
    binding.shift === pressed.shift
  )
}
