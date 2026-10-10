---
id: T-010
title: "Core: registries, commands, keybindings, settings, store"
phase: 0
status: ready
tier: sonnet
depends_on: [T-001]
covers: [P5]
assignee: null
started: null
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
- [ ] AC-1: Unit tests cover every public function, including disposal order, double dispose, and listener removal during notification.
- [ ] AC-2: `select` notifies only when the selected value changes (test with a counter).
- [ ] AC-3: Keybinding tests cover `mod` on macOS and Linux, chords, and conflicts.
- [ ] AC-4: No React, no module names, no `@opencode/*` (`bun run check:deps`).

## Verification
```bash
bun run check
```

## Stop and ask if
- A primitive seems to need knowledge of a specific feature. The host never names a module.

## Result
_Filled in by the agent._
