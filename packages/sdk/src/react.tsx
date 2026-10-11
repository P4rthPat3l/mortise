import type { Store } from "@mortise/core"
import type { ReactElement, ReactNode } from "react"
import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import type { Contract } from "./contract.js"
import type { ModuleHost } from "./host.js"
import type { Live } from "./live.js"
import type { ModuleContext, ModuleInput } from "./module.js"

const HostContext = createContext<ModuleHost | undefined>(undefined)

/** Makes a module host available to the hooks below. Wrap the window's React tree in it once. */
export function ModuleHostProvider(props: { readonly host: ModuleHost; readonly children: ReactNode }): ReactElement {
  return <HostContext.Provider value={props.host}>{props.children}</HostContext.Provider>
}

/** The host from {@link ModuleHostProvider}. Throws when the provider is missing. */
function useModuleHost(): ModuleHost {
  const host = useContext(HostContext)
  if (host === undefined) throw new Error("ModuleHostProvider is missing")
  return host
}

/**
 * The active context of a module, for a component that belongs to it. Throws when the module is not
 * active; gate on {@link useLive} or render only while the module is active.
 */
export function useModule<D extends ModuleInput>(definition: D): ModuleContext<D> {
  const host = useModuleHost()
  const live = useSyncExternalStore(host.subscribe, () => host.module(definition))
  if (live.status !== "active") throw new Error(`Module "${definition.id}" is not active`)
  return live.value
}

/** The current liveness of a contract, re-rendering the component when it changes. */
export function useLive<T>(token: Contract<T>): Live<T> {
  const host = useModuleHost()
  return useSyncExternalStore(host.subscribe, () => host.get(token))
}

/**
 * One selected slice of a store. The component re-renders only when the selected value changes, per
 * `equals` (default `Object.is`). Keep `selector` and `equals` stable to avoid resubscribing.
 */
export function useStoreSelector<T, U>(
  store: Store<T>,
  selector: (value: T) => U,
  equals?: (a: U, b: U) => boolean,
): U {
  const selected = useMemo(() => store.select(selector, equals), [store, selector, equals])
  return useSyncExternalStore(selected.subscribe, selected.getSnapshot)
}
