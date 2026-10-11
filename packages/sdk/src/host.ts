import {
  createDisposable,
  createDisposableScope,
  createStore,
  type Disposable,
  type DisposableScope,
  type Registries,
  type Store,
} from "@mortise/core"
import type { Contract } from "./contract.js"
import type { Live, LiveInactiveReason } from "./live.js"
import type { ModuleContext, ModuleDefinition, ModuleInput, Setup, StoreDefinition } from "./module.js"

const PENDING: Live<never> = { status: "pending" }
const INACTIVE_DISABLED: Live<never> = { status: "inactive", reason: "disabled" }

/** The core services a module host is built on. */
export interface ModuleHostCore {
  /** Contribution points: `ctx.add` writes here. */
  readonly registries: Registries
}

/**
 * The module host. It activates registered modules in dependency order, tracks each module's
 * liveness, and withdraws everything a module registered when it leaves the active state.
 */
export interface ModuleHost {
  /** Registers a module and its synchronous setup. Returns a disposable that unregisters it. */
  register<D extends ModuleInput>(definition: D, setup: Setup<D>): Disposable
  /** Enables or disables a registered module, re-evaluating the modules that require it. */
  setEnabled(definition: { readonly id: string }, enabled: boolean): void
  /** The current liveness of a contract. */
  get<T>(token: Contract<T>): Live<T>
  /** The current liveness of a registered module and, when active, its context. */
  module<D extends ModuleInput>(definition: D): Live<ModuleContext<D>>
  /** Calls the listener whenever a module or contract liveness changes. */
  subscribe(listener: () => void): () => void
  /** Deactivates every module and releases their scopes. */
  dispose(): void
}

type ModuleState =
  | { readonly kind: "inactive"; readonly reason: LiveInactiveReason }
  | { readonly kind: "active"; readonly context: ModuleContext<ModuleDefinition>; readonly generation: number }

interface ModuleRecord {
  readonly definition: ModuleDefinition
  readonly setup: (context: ModuleContext<ModuleDefinition>) => void
  readonly order: number
  enabled: boolean
  activations: number
  scope: DisposableScope | undefined
  state: ModuleState
}

/** Creates a {@link ModuleHost} over the given core services. */
export function createModuleHost({ core }: { readonly core: ModuleHostCore }): ModuleHost {
  const modules = new Map<string, ModuleRecord>()
  const providerModule = new Map<Contract<unknown>, string>()
  const providedValues = new Map<Contract<unknown>, unknown>()
  const listeners = new Set<() => void>()
  const contractCache = new Map<Contract<unknown>, { version: number; live: Live<unknown> }>()
  const moduleCache = new Map<string, { version: number; live: Live<unknown> }>()
  let order = 0
  let version = 0
  let recomputing = false

  function notify(): void {
    version += 1
    for (const listener of [...listeners]) listener()
  }

  function contractActive(token: Contract<unknown>): boolean {
    const moduleId = providerModule.get(token)
    if (moduleId === undefined) return false
    const record = modules.get(moduleId)
    return record !== undefined && record.state.kind === "active" && providedValues.has(token)
  }

  function computeContractLive(token: Contract<unknown>): Live<unknown> {
    const moduleId = providerModule.get(token)
    if (moduleId === undefined) return INACTIVE_DISABLED
    const record = modules.get(moduleId)
    if (record === undefined) return INACTIVE_DISABLED
    if (record.state.kind === "active") {
      if (!providedValues.has(token)) return PENDING
      return { status: "active", value: providedValues.get(token), generation: record.state.generation }
    }
    return { status: "inactive", reason: record.state.reason }
  }

  function computeModuleLive(record: ModuleRecord): Live<ModuleContext<ModuleDefinition>> {
    if (record.state.kind === "active") {
      return { status: "active", value: record.state.context, generation: record.state.generation }
    }
    return { status: "inactive", reason: record.state.reason }
  }

  function get<T>(token: Contract<T>): Live<T> {
    const cached = contractCache.get(token)
    if (cached !== undefined && cached.version === version) return cached.live as Live<T>
    const live = computeContractLive(token)
    contractCache.set(token, { version, live })
    return live as Live<T>
  }

  function moduleLive<D extends ModuleInput>(definition: D): Live<ModuleContext<D>> {
    const cached = moduleCache.get(definition.id)
    if (cached !== undefined && cached.version === version) return cached.live as Live<ModuleContext<D>>
    const record = modules.get(definition.id)
    const live = record === undefined ? INACTIVE_DISABLED : computeModuleLive(record)
    moduleCache.set(definition.id, { version, live })
    return live as Live<ModuleContext<D>>
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** Provider module ids a record requires, ignoring a contract it provides itself. */
  function requiredProviderIds(record: ModuleRecord): string[] {
    const ids = new Set<string>()
    for (const token of Object.values(record.definition.requires)) {
      const providerId = providerModule.get(token)
      if (providerId !== undefined && providerId !== record.definition.id) ids.add(providerId)
    }
    return [...ids]
  }

  function activationOrder(): ModuleRecord[] {
    const records = [...modules.values()].sort((a, b) => a.order - b.order)
    const remaining = new Set(records.map((record) => record.definition.id))
    const ordered: ModuleRecord[] = []
    while (remaining.size > 0) {
      const next = records.find((record) => {
        if (!remaining.has(record.definition.id)) return false
        return requiredProviderIds(record).every((id) => !remaining.has(id))
      })
      if (next === undefined) {
        // A requires cycle: place the remaining modules in registration order. Every member stays blocked.
        for (const record of records) {
          if (remaining.has(record.definition.id)) ordered.push(record)
        }
        break
      }
      ordered.push(next)
      remaining.delete(next.definition.id)
    }
    return ordered
  }

  function disposeInstance(record: ModuleRecord): void {
    record.scope?.dispose()
    record.scope = undefined
  }

  function deactivate(record: ModuleRecord, reason: LiveInactiveReason): boolean {
    const state = record.state
    if (state.kind === "active") {
      disposeInstance(record)
      record.state = { kind: "inactive", reason }
      return true
    }
    if (state.reason === reason) return false
    record.state = { kind: "inactive", reason }
    return true
  }

  function provideValue(token: Contract<unknown>, value: unknown): void {
    if (providedValues.has(token)) throw new Error(`Contract "${token.id}" is already provided`)
    providedValues.set(token, value)
  }

  function createContext(record: ModuleRecord, scope: DisposableScope): ModuleContext<ModuleDefinition> {
    const { definition } = record
    const uses: Record<string, Live<unknown>> = {}
    for (const [key, token] of Object.entries(definition.uses)) uses[key] = computeContractLive(token)
    const requires: Record<string, unknown> = {}
    for (const [key, token] of Object.entries(definition.requires)) requires[key] = providedValues.get(token)
    const stores: Record<string, Store<unknown>> = {}
    for (const [key, declaration] of Object.entries(definition.stores)) {
      stores[key] = createStore((declaration as StoreDefinition<unknown>).initial)
    }
    return {
      id: definition.id,
      signal: scope.signal,
      add(token, item) {
        return scope.add(core.registries.add(token, item))
      },
      provide(token, value) {
        provideValue(token, value)
        return scope.add(() => {
          providedValues.delete(token)
          if (!recomputing) recompute()
        })
      },
      uses,
      requires,
      stores,
    }
  }

  function activate(record: ModuleRecord): void {
    const scope = createDisposableScope()
    const context = createContext(record, scope)
    try {
      const result: unknown = record.setup(context)
      if (isThenable(result)) throw new Error(`Module "${record.definition.id}" setup must be synchronous`)
      record.activations += 1
      record.scope = scope
      record.state = { kind: "active", context, generation: record.activations }
    } catch {
      scope.dispose()
      record.scope = undefined
      record.state = { kind: "inactive", reason: "failed" }
    }
  }

  function evaluate(record: ModuleRecord): void {
    if (!record.enabled) {
      deactivate(record, "disabled")
      return
    }
    const requirementsMet = Object.values(record.definition.requires).every(contractActive)
    if (!requirementsMet) {
      deactivate(record, "blocked")
      return
    }
    if (record.state.kind === "active") return
    if (record.state.reason === "failed") return
    activate(record)
  }

  function recompute(): void {
    if (recomputing) return
    recomputing = true
    try {
      for (const record of activationOrder()) evaluate(record)
    } finally {
      recomputing = false
    }
    notify()
  }

  function register<D extends ModuleInput>(definition: D, setup: Setup<D>): Disposable {
    if (modules.has(definition.id)) throw new Error(`Module "${definition.id}" is already registered`)
    const normalized: ModuleDefinition = {
      id: definition.id,
      provides: definition.provides ?? {},
      uses: definition.uses ?? {},
      requires: definition.requires ?? {},
      stores: definition.stores ?? {},
    }
    for (const token of Object.values(normalized.provides)) {
      const owner = providerModule.get(token)
      if (owner !== undefined) throw new Error(`Contract "${token.id}" is already provided by module "${owner}"`)
    }
    const record: ModuleRecord = {
      definition: normalized,
      // The host erases the module's declared types at this one boundary; the public API re-applies them.
      setup: setup as unknown as (context: ModuleContext<ModuleDefinition>) => void,
      order: order++,
      enabled: true,
      activations: 0,
      scope: undefined,
      state: { kind: "inactive", reason: "blocked" },
    }
    modules.set(normalized.id, record)
    for (const token of Object.values(normalized.provides)) providerModule.set(token, normalized.id)
    recompute()
    return createDisposable(() => {
      if (modules.get(normalized.id) !== record) return
      modules.delete(normalized.id)
      for (const token of Object.values(normalized.provides)) {
        if (providerModule.get(token) === normalized.id) providerModule.delete(token)
      }
      disposeInstance(record)
      recompute()
    })
  }

  function setEnabled(definition: { readonly id: string }, enabled: boolean): void {
    const record = modules.get(definition.id)
    if (record === undefined) throw new Error(`Module "${definition.id}" is not registered`)
    if (record.enabled === enabled) return
    record.enabled = enabled
    recompute()
  }

  function dispose(): void {
    recomputing = true
    try {
      for (const record of [...modules.values()]) disposeInstance(record)
    } finally {
      recomputing = false
    }
    modules.clear()
    providerModule.clear()
    providedValues.clear()
    contractCache.clear()
    moduleCache.clear()
    listeners.clear()
  }

  return { register, setEnabled, get, module: moduleLive, subscribe, dispose }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== "object" || value === null || !("then" in value)) return false
  return typeof (value as { then: unknown }).then === "function"
}
