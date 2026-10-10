# @mortise/sdk

Internal module SDK for first-party feature modules, with React bindings.

- **Status:** Phase 0, task T-011
- **Entry point:** `src/index.ts`

## Responsibility
`Module.define`, contract tokens, liveness (`Live<T>`), declared stores, explicit disposables, and React hooks such as `useModule`. First-party feature modules import this package and their peers' `contract.ts` files only. This API is internal and may change every release; it is never published to third parties.

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
