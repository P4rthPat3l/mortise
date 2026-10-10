import { createDisposable, type Disposable } from "./disposable.js"

/** The layer a value is read from. Read order is project, then user, then the schema default. */
export type SettingsLayer = "default" | "user" | "project"

/** Layers a caller may write. The default layer is the schema's own value. */
export type WritableSettingsLayer = "user" | "project"

const settingValue: unique symbol = Symbol("mortise.setting.value")
const UNSET = Symbol("mortise.setting.unset")

/**
 * A contributed setting. The validator returns true only for values of `T`, so `set` accepts
 * `unknown` from callers and still stores a value of `T`.
 */
export interface SettingSchema<T> {
  readonly id: string
  readonly default: T
  validate(value: unknown): value is T
  /** Phantom type parameter: the setting's value type. */
  readonly [settingValue]?: T
}

interface StoredSetting {
  readonly schema: SettingSchema<unknown>
  user: unknown
  project: unknown
  readonly listeners: Array<(value: unknown) => void>
}

/** The layered settings service. Modules contribute schemas; the host never names one. */
export class SettingsService {
  private readonly settings = new Map<string, StoredSetting>()

  /** Contributes a schema. Throws if the id is already registered. */
  register<T>(schema: SettingSchema<T>): Disposable {
    if (this.settings.has(schema.id)) throw new Error(`Setting "${schema.id}" is already registered`)
    this.settings.set(schema.id, { schema, user: UNSET, project: UNSET, listeners: [] })
    return createDisposable(() => {
      this.settings.delete(schema.id)
    })
  }

  /** The resolved value: project, then user, then the schema default. Throws if unregistered. */
  get<T>(schema: SettingSchema<T>): T {
    return resolved(this.require(schema)) as T
  }

  /** Validates and stores a value in a writable layer, then notifies when the resolved value changed. */
  set<T>(schema: SettingSchema<T>, value: unknown, layer: WritableSettingsLayer): void {
    const stored = this.require(schema)
    if (!stored.schema.validate(value)) throw new Error(`Invalid value for setting "${schema.id}"`)
    const before = resolved(stored)
    if (layer === "user") stored.user = value
    else stored.project = value
    const after = resolved(stored)
    if (Object.is(before, after)) return
    for (const listener of [...stored.listeners]) {
      if (stored.listeners.includes(listener)) listener(after)
    }
  }

  /**
   * Calls the listener whenever the resolved value changes. A listener removed while a notification
   * runs is not called. The returned disposable removes it.
   */
  onChange<T>(schema: SettingSchema<T>, listener: (value: T) => void): Disposable {
    const stored = this.require(schema)
    const wrapped = (value: unknown) => listener(value as T)
    stored.listeners.push(wrapped)
    return createDisposable(() => {
      const index = stored.listeners.indexOf(wrapped)
      if (index !== -1) stored.listeners.splice(index, 1)
    })
  }

  private require<T>(schema: SettingSchema<T>): StoredSetting {
    const stored = this.settings.get(schema.id)
    if (!stored) throw new Error(`Unknown setting "${schema.id}"`)
    return stored
  }
}

function resolved(stored: StoredSetting): unknown {
  if (stored.project !== UNSET) return stored.project
  if (stored.user !== UNSET) return stored.user
  return stored.schema.default
}
