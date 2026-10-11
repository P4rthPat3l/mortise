---
id: T-011
title: Module SDK and FEAT-002
phase: 0
status: review
tier: sonnet
depends_on: [T-010]
covers: [P5]
assignee: deepseek-v4.1-flash
started: 2026-10-11
---

# T-011 Module SDK and FEAT-002

## Goal
First-party feature modules can be declared, activated in dependency order, depend on each other only through contracts, and degrade or block cleanly when a provider is missing or fails. React components reach their module through hooks.

## Read first
- `.agents/skills/feature-documentation/SKILL.md` and `templates/feature-minimal.md`
- `docs/architecture/overview.md`: 6.3, 6.6 "Modules", 6.9 (the `@mortise/sdk` sketch), 6.11
- ADRs 0007 and 0008
- Design reference, read-only, upstream at v2.0.25: `packages/gui-extensions/README.md` ("Anatomy", "The context", "Lifetimes", "Live and failure handling")

## Scope
1. Write `docs/features/FEAT-002-module-system.md` (Mode A, minimal template) and add its index row. Fix the rules before coding.
2. In `packages/sdk/src/`:
   - `module.ts`: `Module.define({ id, provides, uses, requires, stores })` and `Setup<typeof definition>` typing, so reading an undeclared dependency is a compile error.
   - `contract.ts`: `Contract.define<T>(id)` tokens.
   - `live.ts`: `Live<T>`: `{ status: "pending" } | { status: "active", value, generation } | { status: "inactive", reason: "restarting" | "disabled" | "failed" | "blocked" }`.
   - `host.ts`: `createModuleHost({ core })` activates modules in dependency order. A module whose required provider is unavailable is `blocked` and resumes when the provider returns. A setup that throws marks only that module `failed`. Leaving `active` disposes everything the module registered (`DisposableScope` from T-010). Setup is synchronous.
   - `react.tsx`: `ModuleHostProvider`, `useModule()`, `useLive(token)`, `useStoreSelector(store, selector)` built on `useSyncExternalStore`.
3. Tests with two fixture modules defined inside the test files (a provider of a `Greeting` contract and a consumer). Do not add sample modules to production code.

## Out of scope
Real feature modules, persistence of declared stores (later), the public extension API (Phase 3).

## Acceptance criteria
- [ ] AC-1: FEAT-002 exists, passes the skill's blocking checks, and is in the index.
- [ ] AC-2: Tests cover activation order, `blocked` → active when the provider returns, failure isolation, withdrawal of contributions on disable, and `Live` transitions.
- [ ] AC-3: A type test proves that accessing an undeclared dependency does not compile (`// @ts-expect-error`).
- [ ] AC-4: React hook tests render with `@testing-library/react` under `happy-dom`.
- [ ] AC-5: `bun run check` passes.

## Verification
```bash
bun run check
```

## Notes and gotchas
- Decision: `@mortise/core` (T-010) gets no feature document of its own; it is infrastructure, and its API is documented in `packages/core/README.md`. FEAT-002 should describe how the module system uses the core primitives (disposable scopes, registries, the store) and link to that README rather than restating it.
- You may add exactly these dev dependencies to `packages/sdk`: `happy-dom` and `@testing-library/react` (latest stable). Set the Vitest environment per file with `// @vitest-environment happy-dom`.
- Upstream relies on Solid's ownership tree for cleanup. React has none, so lifetimes are explicit scopes.

## Stop and ask if
- The typing for declared dependencies gets complex enough to hurt readability. Propose a simpler shape first.

## Result

Implemented FEAT-002 and the `@mortise/sdk` module system in `packages/sdk/src/`, plus the feature
document. Branch `t011-module-sdk`.

**What changed**

- `docs/features/FEAT-002-module-system.md` (Mode A then Mode D) and its row in
  `docs/features/_index.md`. Rules fixed before coding.
- `packages/sdk/src/contract.ts` — `Contract.define<T>(id)` tokens and `ContractValue<C>`.
- `packages/sdk/src/live.ts` — `Live<T>`: `pending` · `active` (value, generation) · `inactive`
  (reason: restarting/disabled/failed/blocked).
- `packages/sdk/src/module.ts` — `Module.define`, `ModuleInput`, `ModuleDefinition`,
  `ModuleContext<D>`, `Setup<D>`, `Store.define` and the context types. The context is derived from the
  module's own declarations, so reading an undeclared `uses`/`requires`/`stores` key or providing an
  undeclared contract is a compile error.
- `packages/sdk/src/host.ts` — `createModuleHost({ core })`: dependency-ordered activation, blocking
  and automatic resumption, failure isolation (a throw or thenable fails only that module), disable
  and enable, scope-owned withdrawal, cached `get`/`module` `Live` values, and `subscribe`.
- `packages/sdk/src/react.tsx` — `ModuleHostProvider`, `useModule`, `useLive`, `useStoreSelector` on
  `useSyncExternalStore`.
- `packages/sdk/src/index.ts` — JSDoc'd public exports.
- `packages/sdk/README.md` — responsibility, manifest example and the public API table.
- Tests next to the code: `contract.test.ts`, `module.test.ts` (with `// @ts-expect-error` type tests),
  `host.test.ts`, `react.test.tsx` (happy-dom). 21 tests, named for the rule IDs.

**Design decisions worth review**

- `useModule(definition)` takes the module's definition because React has no ownership tree; the
  binding is explicit (FEAT-002 DEC-001). The task named `useModule()`; the argument is the smallest
  change that makes the hook usable and keeps the typed context.
- `ctx.uses` is a `Live<T>` snapshot taken when setup runs; components use `useLive(token)` for
  reactivity (DEC-005).
- Declared `stores` are descriptors (`Store.define(initial)`) created per activation, avoiding
  module-level state and leaving room for persistence (DEC-002).
- A setup throw is terminal (`failed`); a missing required provider is resumable (`blocked`)
  (DEC-003).

**Verification**

`bun run check` passes: Biome clean, all ten packages typecheck, `check:deps` reports no violations
(103 modules, 262 dependencies), 178 tests pass with 2 integration tests skipped. The task's only
Verification command is `bun run check`; `bun run test` and `bun run typecheck` were run as part of it.

**Not done / open**

- Declared stores are not persisted; that is out of scope and recorded in FEAT-002 §3 and RISK-003.
- `restarting` is in the `Live` vocabulary but never emitted; the host reaches `blocked → active`
  instead (DEC-006).
- The feature document §28 Q-001 asks whether T-012 needs commands, settings or the event bus on the
  module context. `createModuleHost` currently takes only `{ registries }`. If T-012 needs more, extend
  `ModuleHostCore` rather than reaching into `@mortise/core` from a module.
- **Dev-dependency deviation:** the task allowed exactly `happy-dom` and `@testing-library/react`.
  `@testing-library/react` declares `@testing-library/dom`, `react-dom` and `@types/react-dom` as
  required peers, and without them the hook tests cannot run under the isolated linker. I added those
  three to `packages/sdk` devDependencies as well. No runtime dependency was added.

**Commits:** the FEAT-002 Mode A document, the SDK implementation, the FEAT-002 Mode D sync (verified
at `d784c30`, the final code commit), a test-name correction in `react.test.tsx`, and the task result.
