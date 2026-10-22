# @mortise/ui

Design system: tokens, primitives and the theme engine.

- **Status:** Phase 1. Phase 0 adds only minimal base tokens, in T-012
- **Entry points:** `src/index.ts` (TypeScript API) and `src/tokens.css` (CSS variables)

## Responsibility
Design tokens as CSS variables, accessible primitives, theme loading (DesktopTheme-compatible JSON) and later VS Code theme import. It must not read application state.

## Tokens

`tokens.css` exports the base variables every workbench surface uses: `--background`,
`--foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`,
`--sans`, `--mono`, `--space-1`…`--space-5` and `--radius`. Light values are the default, dark
values follow `prefers-color-scheme`, and `data-theme="light"` or `data-theme="dark"` on the root
overrides the system preference. Import it once from the renderer entry: `@mortise/ui/tokens.css`.

## Allowed imports
- `react`

## Forbidden imports
- `@opencode/*`
- `electron`
- Every `@mortise/*` package

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
