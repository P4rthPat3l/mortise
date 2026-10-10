---
id: T-011
title: Module SDK and FEAT-002
phase: 0
status: ready
tier: sonnet
depends_on: [T-010]
covers: [P5]
assignee: null
started: null
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
_Filled in by the agent._
