# @mortise/core

Framework-free application core: registries, commands, keybindings, settings and store.

- **Status:** Phase 0, task T-010
- **Entry point:** `src/index.ts`

## Responsibility
Contribution registries, the command service, the keybinding resolver, the layered settings service, the read-only store and the domain event bus. It must not name any specific feature module and must not depend on a UI framework.

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
