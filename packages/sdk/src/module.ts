import type { Store as CoreStore, Disposable, Registry } from "@mortise/core"
import type { Contract, ContractValue } from "./contract.js"
import type { Live } from "./live.js"

/** The contracts a module may declare. Keys are local names; values are contract tokens. */
export type Contracts = Record<string, Contract<unknown>>

/** The declared stores of a module. Keys are local names; values are store declarations. */
export type StoreDefinitions = Record<string, StoreDefinition<unknown>>

const storeValue: unique symbol = Symbol("mortise.store.value")

/**
 * A store a module declares. The host creates one reactive store per activation from `initial`; a
 * later phase persists it. The value type is carried by a phantom property.
 */
export interface StoreDefinition<T> {
  /** The value a fresh store starts from. */
  readonly initial: T
  /** Phantom type parameter: the store's value type. */
  readonly [storeValue]?: T
}

/** The value type of a {@link StoreDefinition}. */
export type StoreValue<S> = S extends StoreDefinition<infer T> ? T : never

/** Creates store declarations. */
export const Store = {
  /** Declares a store whose fresh value is `initial`. */
  define<T>(initial: T): StoreDefinition<T> {
    return { initial }
  },
}

/** The manifest a module passes to {@link Module.define}. Every field but `id` is optional. */
export interface ModuleInput {
  /** Unique module id. Keys local to the module are namespaced under it by convention. */
  readonly id: string
  /** Contracts this module supplies. A duplicate provider across modules is an error. */
  readonly provides?: Contracts
  /** Optional dependencies. Read as `Live<T>`; their absence never blocks the module. */
  readonly uses?: Contracts
  /** Hard dependencies. The module is blocked until every one is active. */
  readonly requires?: Contracts
  /** State the module owns, created by the host per activation. */
  readonly stores?: StoreDefinitions
}

/** Every field of a manifest, present. The host's erased view of a module. */
export interface ModuleDefinition {
  readonly id: string
  readonly provides: Contracts
  readonly uses: Contracts
  readonly requires: Contracts
  readonly stores: StoreDefinitions
}

/** An empty record, the fallback when a definition declares no keys for a field. */
export type NoKeys = Record<never, never>

/** The `provides` record of a definition, or {@link NoKeys} when it declares none. */
export type ProvidesOf<D extends ModuleInput> = D extends { provides: infer P extends Contracts } ? P : NoKeys

/** The `uses` record of a definition, or {@link NoKeys} when it declares none. */
export type UsesOf<D extends ModuleInput> = D extends { uses: infer U extends Contracts } ? U : NoKeys

/** The `requires` record of a definition, or {@link NoKeys} when it declares none. */
export type RequiresOf<D extends ModuleInput> = D extends { requires: infer R extends Contracts } ? R : NoKeys

/** The `stores` record of a definition, or {@link NoKeys} when it declares none. */
export type StoresOf<D extends ModuleInput> = D extends { stores: infer S extends StoreDefinitions } ? S : NoKeys

/** A module's optional dependencies, each as a {@link Live} value. */
export type UsesContext<D extends ModuleInput> = {
  readonly [K in keyof UsesOf<D>]: Live<ContractValue<UsesOf<D>[K]>>
}

/** A module's hard dependencies, each as its resolved value. */
export type RequiresContext<D extends ModuleInput> = {
  readonly [K in keyof RequiresOf<D>]: ContractValue<RequiresOf<D>[K]>
}

/** A module's declared stores, each as a reactive store. */
export type StoresContext<D extends ModuleInput> = {
  readonly [K in keyof StoresOf<D>]: CoreStore<StoreValue<StoresOf<D>[K]>>
}

/**
 * The context a module's setup receives. Reading `uses`, `requires` or `stores` under a key that
 * the module did not declare is a compile error.
 */
export interface ModuleContext<D extends ModuleInput = ModuleDefinition> {
  /** The module's id. */
  readonly id: D["id"]
  /** Aborted when the module leaves the active state. Async work checks it after every await. */
  readonly signal: AbortSignal
  /** Contributes an item to a registry; the contribution is withdrawn with the activation. */
  add<T>(token: Registry<T>, item: T): Disposable
  /** Supplies a declared contract's value; withdrawn with the activation. */
  provide<K extends keyof ProvidesOf<D>>(token: ProvidesOf<D>[K], value: ContractValue<ProvidesOf<D>[K]>): Disposable
  /** Optional dependencies, as values read when setup runs. */
  readonly uses: UsesContext<D>
  /** Hard dependencies; every one is available while the module is active. */
  readonly requires: RequiresContext<D>
  /** The module's declared stores, created for this activation. */
  readonly stores: StoresContext<D>
}

/** A module's synchronous setup function, typed by the definition it belongs to. */
export type Setup<D extends ModuleInput> = (context: ModuleContext<D>) => void

/** Creates module manifests. */
export const Module = {
  /**
   * Validates and returns a manifest. The returned type keeps the declared keys, so
   * `Setup<typeof definition>` sees exactly the dependencies the module declared.
   */
  define<const D extends ModuleInput>(definition: D): D {
    return definition
  },
}
