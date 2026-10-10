---
id: T-010
title: "Core: registries, commands, keybindings, settings, store"
phase: 0
status: review
tier: sonnet
depends_on: [T-001]
covers: [P5]
assignee: deepseek-v4.1-flash
started: 2026-10-10
---

# T-010 Core: registries, commands, keybindings, settings, store

## Goal
`@mortise/core` provides the framework-free backbone every feature module builds on: disposables, typed registries, the command service, keybinding resolution, layered settings, a reactive store and a domain event bus.

## Read first
- `docs/architecture/overview.md`: 6.2, 6.4, 6.5, 6.6 "Modules", 6.11
- `packages/core/README.md`
- Design reference, read-only, upstream at v2.0.25: `packages/gui-extensions/README.md` ("Primitives", "Lifetimes", "Catalog")

## Scope
Files in `packages/core/src/`, re-exported from `index.ts`:
- `disposable.ts`: `Disposable`, `DisposableScope` (child scopes, an `AbortSignal`, idempotent `dispose()`, LIFO cleanup).
- `registry.ts`: `Registry.define<T>(id)` tokens; a `Registries` container with `add(token, item) → Disposable`, `list(token)`, `subscribe(token, listener)`. List results are stable objects while nothing changes.
- `commands.ts`: `CommandService` with `register({ id, title, run, enabled? }) → Disposable`, `execute(id, ...args)`, `list()`. Duplicate ids are an error. `execute` on a disabled or missing command rejects with a typed error.
- `keybindings.ts`: parse `"mod+shift+t"` and two-step chords, map `mod` per platform, resolve a framework-free key event shape to a command id, and report conflicts.
- `settings.ts`: layered values (defaults < user < project), schemas contributed by modules with validator functions (no Zod here), `get`, `set`, `onChange`.
- `store.ts`: `createStore(initial)` with `getSnapshot`, `subscribe`, `update(fn)`, `batch(fn)`, and `select(selector, equals?)`, compatible with React's `useSyncExternalStore`.
- `events.ts`: a typed event bus for `DomainEvent`.

## Out of scope
React bindings (T-011), any feature-specific registry items, persistence (later).

## Acceptance criteria
- [x] AC-1: Unit tests cover every public function, including disposal order, double dispose, and listener removal during notification.
- [x] AC-2: `select` notifies only when the selected value changes (test with a counter).
- [x] AC-3: Keybinding tests cover `mod` on macOS and Linux, chords, and conflicts.
- [x] AC-4: No React, no module names, no `@opencode/*` (`bun run check:deps`).

## Verification
```bash
bun run check
```

## Stop and ask if
- A primitive seems to need knowledge of a specific feature. The host never names a module.

## Result

Implemented the `@mortise/core` backbone in `packages/core/src/`, re-exported from `index.ts`.

**What changed**

- `disposable.ts` — `Disposable`, `Cleanup`, `DisposableScope`, `createDisposable`, `createDisposableScope`. Idempotent disposal, LIFO cleanup, child scopes owned by their parent, an `AbortSignal` aborted on dispose, and registrations after disposal run at once.
- `registry.ts` — `Registry.define<T>(id)` tokens and a `Registries` container with `add`, `list`, `subscribe`. Lists are stable references until they change; listeners removed during a notification are skipped.
- `commands.ts` — `Command`, `CommandInfo`, `CommandError`, `CommandService` with `register`, `execute`, `list`. Duplicate ids throw a `"duplicate"` error; `execute` rejects with `"not-found"` or `"disabled"` (a synchronous throw from `run` becomes a rejection).
- `keybindings.ts` — `Platform`, `KeyEvent`, `Chord`, `Keybinding`, `KeybindingConflict`, `Keybindings`, `parseKeybinding`. Parses modifiers and one- or two-step chords, maps `mod` to meta on macOS and control elsewhere, resolves key events to command ids, and reports conflicts with `mod` canonicalized per platform.
- `settings.ts` — `SettingsLayer`, `WritableSettingsLayer`, `SettingSchema`, `SettingsService` with `register`, `get`, `set`, `onChange`. Resolution order is project > user > default; contributed validators run on `set`; `onChange` fires only when the resolved value changes. An `UNSET` sentinel distinguishes an unset layer from a stored `null`.
- `store.ts` — `ReadableStore`, `Store`, `createStore` with `getSnapshot`, `subscribe`, `update`, `batch`, `select`. `subscribe` returns an unsubscribe function so it fits `useSyncExternalStore`; `select` caches the selection and notifies only on change.
- `events.ts` — `DomainEventType`, `DomainEventListener`, `EventBus`, `createEventBus`, a typed bus over `@mortise/domain`'s `DomainEvent`.
- Tests next to the code: `disposable.test.ts`, `registry.test.ts`, `commands.test.ts`, `keybindings.test.ts`, `settings.test.ts`, `store.test.ts`, `events.test.ts`, 56 tests named `AC-1`–`AC-4`.
- `packages/core/README.md` documents the public API table.
- `packages/core/tsconfig.json` adds the `DOM` lib, needed only for the `AbortSignal` type on `DisposableScope.signal` (the same reason `engine-opencode` and `sdk` include it). This is a package-level lib, not a change to `tsconfig.base.json` strictness.

**Verification**

`bun run check` passes: Biome clean, all packages typecheck, `check:deps` reports no violations (56 modules, 88 dependencies), 56 tests pass (2 integration tests skipped, as expected).

**Not done / open**

- No `docs/features/` document was added. Per the AGENTS.md feature-to-task map, the module system is FEAT-002, written in T-011, which builds on this package. The core is infrastructure, not a user-facing feature, so its API is recorded in the package README. If the maintainer wants core documented as its own feature, take the next free `FEAT-NNN`; otherwise fold the core API into FEAT-002 during T-011.
- Design choices worth confirming: `Registries.add` allows the same item twice (only `CommandService` treats duplicates as an error); the store's `select` with the default `Object.is` equality requires a stable or equal selector value (React's `useSyncExternalStoreWithSelector` has the same requirement).

**Suggested commit:** `feat(core): add registries, commands, keybindings, settings and store`
