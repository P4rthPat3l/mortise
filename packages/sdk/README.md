# @mortise/sdk

Internal module SDK for first-party feature modules, with React bindings.

- **Status:** Phase 0, task T-011
- **Entry point:** `src/index.ts`

## Responsibility
`Module.define`, contract tokens, liveness (`Live<T>`), declared stores, explicit disposables, and React hooks (`ModuleHostProvider`, `useModule`, `useLive`, `useStoreSelector`). First-party feature modules import this package and their peers' `contract.ts` files only. This API is internal and may change every release; it is never published to third parties.

Every module declares its dependencies. Reading a key it did not declare is a compile error, because the context type is derived from the module's own definition:

```tsx
import { Contract, Module, Store, type Setup } from "@mortise/sdk"

export const Greeting = Contract.define<{ message: string }>("greeting")

export const definition = Module.define({
  id: "greeter",
  provides: { greeting: Greeting },
  requires: { transport: Transport },
  uses: { theme: Theme },
  stores: { prefs: Store.define({ expanded: true }) },
})

export const setup: Setup<typeof definition> = (ctx) => {
  ctx.provide(Greeting, { message: "hello" })
  ctx.add(SomeRegistry, item)
}
```

`createModuleHost({ core })` activates registered modules in dependency order. A module whose
`requires` are unavailable is `blocked` and resumes on its own; a setup that throws marks only that
module `failed`; leaving `active` disposes the module's scope with everything it registered.

## Public API

| Module | Exports | Responsibility |
| --- | --- | --- |
| `contract.ts` | `Contract`, `ContractValue` | Typed contract tokens (`Contract.define<T>(id)`) and their value type. |
| `live.ts` | `Live`, `LiveInactiveReason` | Liveness: `pending`, `active` (with `generation`), or `inactive` with a reason. |
| `module.ts` | `Module`, `ModuleInput`, `ModuleDefinition`, `ModuleContext`, `Setup`, `ProvidesOf`, `UsesOf`, `RequiresOf`, `StoresOf`, `UsesContext`, `RequiresContext`, `StoresContext`, `Store`, `StoreDefinition`, `StoreValue`, `Contracts` | The manifest, the typed setup context and declared stores. |
| `host.ts` | `createModuleHost`, `ModuleHost`, `ModuleHostCore` | Dependency-ordered activation, blocking, failure isolation, disable and withdrawal. |
| `react.tsx` | `ModuleHostProvider`, `useModule`, `useLive`, `useStoreSelector` | React bindings on `useSyncExternalStore`. |

`ModuleHostCore` is the slice of `@mortise/core` the host needs: its `Registries` container. See
`../core/README.md` for the disposable scopes, registries and store this package builds on.

## Testing

Unit and type tests run next to the code. The React hook tests set the environment per file with
`// @vitest-environment happy-dom`; the dev dependencies `happy-dom` and `@testing-library/react`
carry their peers (`@testing-library/dom`, `react-dom`).

## Allowed imports
- `@mortise/core`
- `@mortise/domain`
- `react`

## Forbidden imports
- `@opencode/*`
- `electron`
- `@mortise/engine-opencode`
- `@mortise/gateway-core`

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
