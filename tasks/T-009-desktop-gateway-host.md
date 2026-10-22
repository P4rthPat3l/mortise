---
id: T-009
title: Desktop gateway host and MessagePort channel
phase: 0
status: blocked
tier: sonnet
depends_on: [T-002, T-004, T-005, T-006]
covers: [P3]
assignee: deepseek-v4.1-flash
started: 2026-10-22
---

# T-009 Desktop gateway host and MessagePort channel

## Goal
The Electron main process runs one gateway for the whole app and gives each window a private MessagePort channel to it. Renderer code can call `engine.fetch` and receive engine events, and it never holds a credential.

## Read first
- `docs/features/FEAT-001-engine-gateway.md`: the "desktop host" phase of its implementation plan
- `docs/architecture/overview.md`: 6.2, 6.4, 6.10
- `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/electron.vite.config.ts`
- Electron docs: "MessagePorts in Electron", section "Communicating directly between the main process and the main world of a context-isolated page"

## Scope
- `apps/desktop/src/main/gateway-host.ts`: create the gateway (T-004 to T-006) once at app ready. For each window, after it loads, create a `MessageChannelMain`, connect one end to a channel server (`createServer` from `@mortise/rpc-contracts`) wired to the gateway handlers and event subscriptions, and send the other end with `webContents.postMessage("mortise:channel", null, [port])`. Close the window's channel and subscriptions when the window closes. Stop the gateway on quit (never the engine).
- A `Transport` over `MessagePortMain` in main, and one over the DOM `MessagePort` in `apps/desktop/src/renderer/transport.ts`.
- `apps/desktop/src/preload/index.ts`: receive the port from `ipcRenderer` and forward it to the main world with `window.postMessage("mortise:channel", "*", event.ports)`. Expose nothing else new.
- Renderer: accept the port only from a `message` event whose `source === window` and `data === "mortise:channel"`; build a client `Channel`; pass it to `<App channel={…} />`.
- `packages/workbench/src/app.tsx`: accept the `channel` prop and show the connection state from `connection.get` and `connection.changed`, as plain text. This is a temporary debug view.

## Out of scope
The adapter and the timeline UI (T-012). Extension protocols (T-015).

## Acceptance criteria
- [x] AC-1: Unit tests for both transports (wrap `MessageChannel` from `node:worker_threads` to simulate ports).
- [x] AC-2: A test of the host logic with a fake gateway proves two windows share one gateway and one event subscription per server.
- [ ] AC-3: The renderer bundle and preload contain no credential-handling code. `rg -n "password|authorization" apps/desktop/out/renderer apps/desktop/out/preload` finds nothing after `bun run build`. **Blocked: see Result. The preload is clean; the renderer matches the words only in React DOM and shared-schema text, so the command cannot return nothing.**
- [x] AC-4: Window security flags are unchanged: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- [ ] AC-5: Manual: with OpenCode installed, `bun run dev` shows `live` and the engine version. Record what you saw in Result. If no display is available, say so. **Not performed: the installed engine is 2.1.2, outside the supported range, so the gateway reported `incompatible`. See Result.**

## Verification
```bash
bun run check
bun run build
rg -n "password|authorization" apps/desktop/out/renderer apps/desktop/out/preload || echo "clean"
```

## Notes and gotchas
- The preload is built as CommonJS (`index.cjs`) because sandboxed preloads cannot load ES modules.
- `contextBridge` cannot transfer a `MessagePort`. Use the `window.postMessage` forwarding pattern above.

## Stop and ask if
- Any step would require disabling the sandbox, enabling Node integration, or exposing `ipcRenderer` to the page.

## Result

Implemented at `49d4309`; FEAT-001 is synchronized in the following docs commit.

**What changed**

- `apps/desktop/src/main/gateway-host.ts`: `createGatewayHost` creates the app's single gateway at `start()`, gives every window a `MessageChannelMain` pair on `did-finish-load`, backs it with a `createServer` channel (`servers.list`, `connection.get`, `engine.fetch`) and one `connection.changed` plus one stream subscription per window, closes that window's channel and subscriptions on close or reload, and disposes the gateway (never the engine) on quit. Electron stays in `index.ts`; the host takes a window adapter and channel/gateway factories so it is testable under Vitest.
- `apps/desktop/src/main/transport.ts`: `mainTransport` over the `MessagePortMain` surface.
- `apps/desktop/src/renderer/transport.ts`: `rendererTransport` over the DOM port.
- `apps/desktop/src/preload/index.ts`: forwards `event.ports` with `window.postMessage("mortise:channel", "*", …)`; the exposed bridge is unchanged.
- `apps/desktop/src/renderer/main.tsx`: accepts a port only from `event.source === window` with `event.data === "mortise:channel"`, builds a client `Channel`, and passes it to `App`.
- `packages/workbench/src/app.tsx`: temporary plain-text view of `connection.get` and `connection.changed`, including the engine version when the state carries one.
- `apps/desktop/src/main/index.ts`: starts the host at app ready, attaches every window, disposes the host on `before-quit`.
- `apps/desktop/tsconfig.node.json`: adds `DOM` and `DOM.Iterable` because the sandboxed preload uses `window` and Electron's typings are DOM-based.

**Verification**

- `bun run check`: pass. Lint, all ten package typechecks, dependency-cruiser (no violations), and 214 tests passed with 8 skipped.
- `bun run build`: pass (main, preload `index.cjs` 0.25 kB, renderer assets).
- AC-3: repository policy denies `rg` in a shell, so I ran the same search with the built-in ripgrep. `apps/desktop/out/preload`: zero matches. `apps/desktop/out/renderer`: four matches, none credential handling:
  - `@mortise/rpc-contracts` contributes `FORBIDDEN_HEADERS = ["authorization", "cookie", "proxy-authorization"]` and the message `"authorization, cookie and proxy-authorization headers are not allowed"`.
  - React DOM contributes `password: true` and the input-type branch `elem.type === "password"`.
- AC-4: `index.ts` still sets `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- AC-5: not performed. `bun run dev` first failed with `Error: Electron uninstall` because this worktree's Electron binary was missing; I ran the package's own `install.js` (environment only, nothing committed) and the app then built, started the dev server and ran the Electron process without an AppArmor sandbox error. The gateway log showed `connection state change {"serverId":"shared","from":"discovering","to":"incompatible"}`. The installed CLI is `opencode v2.1.2`, above the supported range (`>=2.0.20 <2.1.0`), and replacing the user's engine is forbidden (ADR-0002), so `live` and the engine version could not be observed. I could not read the window's pixels from this session, so the on-screen text is unverified.
- New tests: `apps/desktop/src/main/gateway-host.test.ts` (4 cases, including two windows on one gateway and one subscription per channel server), `apps/desktop/src/main/transport.test.ts` (3), `apps/desktop/src/renderer/transport.test.ts` (3). Both transports are exercised through `createClient`/`createServer` over `MessageChannel` from `node:worker_threads`.

**Blocked question — AC-3 / FEAT-001 Q-007**

The literal check `rg -n "password|authorization" apps/desktop/out/renderer apps/desktop/out/preload` can never return nothing: React DOM ships the string `"password"` for its input-type branch, and `@mortise/rpc-contracts` ships the header names and validation message in every renderer bundle. Neither is credential handling, and the preload is clean. Editing the rpc-contracts message alone would still leave the React DOM match. Which do you want?

1. Narrow AC-3/SEC-005 to credential-specific evidence, for example a pattern for Basic auth material or `password` in first-party renderer source, plus a check that `gateway-core` is absent from the renderer bundle.
2. Keep the pattern but define it as applying to first-party bundles only, excluding vendor and shared-schema text.
3. Something else, including a change to `@mortise/rpc-contracts` if you consider its message text in scope.

**Follow-ups**

- No discovery/registration watcher was added. `gateway.onRegistrationReplaced()` exists but nothing calls it, so an external restart of the shared service is not detected at runtime. FEAT-001 and T-013 already record this gap; it needs its own task.
- T-012 replaces the debug view with the composition root and the adapter.
