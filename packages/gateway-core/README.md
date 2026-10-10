# @mortise/gateway-core

Host-neutral engine gateway: discovery, credentials, event stream and request forwarding.

- **Status:** Phase 0, tasks T-004, T-005, T-006
- **Entry point:** `src/index.ts`

## Responsibility
Finds or starts the user's OpenCode service without ever replacing it, holds engine credentials, keeps one event-stream subscription per server with resync, and forwards UI requests with authentication added. It runs inside the Electron main process today and inside a Node server later, so it must never import Electron.

## Allowed imports
- `@opencode/client/service`
- `@opencode/client` (types only, for server info)
- `@mortise/domain`
- `@mortise/rpc-contracts`
- `zod`
- Node built-in modules

## Forbidden imports
- `electron`
- `react`
- DOM APIs
- `@mortise/engine-opencode`
- `@mortise/core`
- `@mortise/sdk`
- `@mortise/ui`

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
