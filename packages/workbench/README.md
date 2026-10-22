# @mortise/workbench

The React user interface: app shell, composition root and first-party feature modules.

- **Status:** Phase 0 skeleton; tasks T-009, T-011 and T-012
- **Entry point:** `src/index.ts` exports `App`

## Responsibility
Everything the user sees, shared by the desktop app now and the web and mobile builds later. It receives a gateway `Channel` from its host (Electron preload today, WebSocket later) and never knows which host it runs in.

- `src/bootstrap/` (T-012): the composition root. `createWorkbenchRuntime` builds the adapter over the channel's `engine.fetch`, creates the timeline and session stores, registers the modules, applies event batches once per frame, and runs the resync procedure.
- `src/modules/<id>/`: first-party feature modules: `sessions` (list), `timeline` (view and streaming leaves) and `composer` (prompt box). See `src/modules/README.md`.
- `src/shell.tsx`: the three-region layout. It renders the views the composition root supplies and reads only the connection store.

## Allowed imports
- `@mortise/core`, `@mortise/sdk`, `@mortise/ui`, `@mortise/domain`, `@mortise/rpc-contracts`
- `@mortise/engine-opencode`, from `src/bootstrap/` only
- `react`, `react-dom`

## Forbidden imports
- `@opencode/*`
- `electron` and Node built-in modules
- `@mortise/gateway-core`

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
