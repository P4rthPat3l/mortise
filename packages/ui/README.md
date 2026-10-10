# @mortise/ui

Design system: tokens, primitives and the theme engine.

- **Status:** Phase 1. Phase 0 adds only minimal base tokens, in T-012
- **Entry point:** `src/index.ts`

## Responsibility
Design tokens as CSS variables, accessible primitives, theme loading (DesktopTheme-compatible JSON) and later VS Code theme import. It must not read application state.

## Allowed imports
- `react`

## Forbidden imports
- `@opencode/*`
- `electron`
- Every `@mortise/*` package

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
