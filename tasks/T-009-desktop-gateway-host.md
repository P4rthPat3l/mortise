---
id: T-009
title: Desktop gateway host and MessagePort channel
phase: 0
status: ready
tier: sonnet
depends_on: [T-002, T-004, T-005, T-006]
covers: [P3]
assignee: null
started: null
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
- [ ] AC-1: Unit tests for both transports (wrap `MessageChannel` from `node:worker_threads` to simulate ports).
- [ ] AC-2: A test of the host logic with a fake gateway proves two windows share one gateway and one event subscription per server.
- [ ] AC-3: The renderer bundle and preload contain no credential-handling code. `rg -n "password|authorization" apps/desktop/out/renderer apps/desktop/out/preload` finds nothing after `bun run build`.
- [ ] AC-4: Window security flags are unchanged: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- [ ] AC-5: Manual: with OpenCode installed, `bun run dev` shows `live` and the engine version. Record what you saw in Result. If no display is available, say so.

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
_Filled in by the agent._
