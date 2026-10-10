# @mortise/core

Framework-free application core: registries, commands, keybindings, settings and store.

- **Status:** Phase 0, task T-010
- **Entry point:** `src/index.ts`

## Responsibility
Contribution registries, the command service, the keybinding resolver, the layered settings service, the reactive store and the domain event bus. It must not name any specific feature module and must not depend on a UI framework.

## Public API

| Module | Exports | Responsibility |
| --- | --- | --- |
| `disposable.ts` | `Disposable`, `Cleanup`, `DisposableScope`, `createDisposable`, `createDisposableScope` | Idempotent cleanups, last-in-first-out disposal, child scopes and an `AbortSignal`. |
| `registry.ts` | `Registry`, `Registries` | Typed contribution tokens and the container that keeps one stable list per token. |
| `commands.ts` | `Command`, `CommandInfo`, `CommandError`, `CommandService` | One handler per unique id; typed `not-found`, `disabled` and `duplicate` failures. |
| `keybindings.ts` | `Platform`, `KeyEvent`, `Chord`, `Keybinding`, `KeybindingConflict`, `Keybindings`, `parseKeybinding` | One- and two-step bindings, `mod` mapped per platform, conflict reporting. |
| `settings.ts` | `SettingsLayer`, `WritableSettingsLayer`, `SettingSchema`, `SettingsService` | Layered values (defaults < user < project) validated by contributed schemas. |
| `store.ts` | `ReadableStore`, `Store`, `createStore` | Reactive value with `batch` and `select`, shaped for `useSyncExternalStore`. |
| `events.ts` | `DomainEventType`, `DomainEventListener`, `EventBus`, `createEventBus` | Typed, past-tense bus over the domain `DomainEvent`. |

The store's `subscribe` returns an unsubscribe function rather than a `Disposable` so it matches React's `useSyncExternalStore` without a wrapper. Everything else that can be withdrawn returns a `Disposable`.

`tsconfig.json` includes the `DOM` lib for the `AbortSignal` type only. The core does not read DOM state or Node APIs.

## Allowed imports
- `@mortise/domain`

## Forbidden imports
- `@opencode/*`
- `react`
- `electron`
- `@mortise/engine-opencode`
- `@mortise/gateway-core`
- Node APIs

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
