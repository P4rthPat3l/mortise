---
id: T-012
title: Workbench composition root and streaming timeline
phase: 0
status: review
tier: sonnet
depends_on: [T-008, T-009, T-011]
covers: [P3, P4, P8]
assignee: opencode
started: 2026-10-22
---

# T-012 Workbench composition root and streaming timeline

## Goal
The desktop window lists sessions from the user's OpenCode service, shows one session's timeline with live streaming text, sends a prompt idempotently, and recovers correctly after a resync. Streaming re-renders only the parts that changed.

## Read first
- `docs/architecture/overview.md`: "Repository mapping", 6.5, 6.7, 6.11
- `docs/architecture/roadmap.md`: P3, P4, P8
- `packages/workbench/README.md`, `packages/workbench/src/modules/README.md`
- `packages/engine-opencode/README.md` (from T-008), `packages/sdk/src/` (from T-011)

## Scope
- `packages/workbench/src/bootstrap/`: the composition root. Build `gatewayFetch` on the channel's `engine.fetch` (encode and decode bodies), create the adapter, subscribe to `engine.events` and `engine.resync`, feed `translate()` output into a timeline store from `@mortise/core`, and run the resync procedure: refetch active sessions, pending requests, and the latest page of each visible session, then replace partial parts.
- Timeline store normalized by session, item and part id. Apply event batches once per animation frame.
- Modules in `src/modules/`: `sessions` (list), `timeline` (view), `composer` (prompt box using a client-generated message id; retry reuses it). They communicate through contracts only.
- `StreamingText` leaf component subscribed to one part (pattern in overview 6.11).
- Minimal base tokens in `packages/ui/src/tokens.css` (background, foreground, muted, accent, border, monospace and sans font stacks, spacing scale), with light and dark values, exported for the workbench to import. Plain styling with these tokens is enough.

## Out of scope
Permissions and forms UI, settings, theming, multiple servers.

## Acceptance criteria
- [x] AC-1: Store and resync unit tests: applying a resync with fresh snapshots yields the same state as a fresh load (use T-007 fixtures).
- [x] AC-2: Render-count test: streaming 2,000 text deltas into one part re-renders only that part's component; sibling parts and the session list do not re-render.
- [x] AC-3: A retried prompt with the same client message id produces one user message (test with a fake channel).
- [x] AC-4: `bun run check:deps` passes. Only `src/bootstrap/` imports the adapter; modules import peers only through `contract.ts`.
- [x] AC-5: Manual: with OpenCode running, `bun run dev` lists real sessions and streams a reply. Record what you saw in Result (no screenshots of private content).

## Verification
```bash
bun run check
bun run build
```

## Notes and gotchas
- Fix from the wave 2 review: `packages/engine-opencode/src/events.ts` keeps its diagnostics counters in module-level state (`const counters`), which AGENTS.md forbids in UI code and which would mix counts across servers. Move the counters onto the adapter instance created by `createAdapter`, and drop `resetEventDiagnostics` in favor of creating a fresh adapter in tests.
- Open items handed over by T-002 and T-008: confirm `engine.fetch`'s `query` type (`Record<string, string | string[]>`) covers the generated client's query shapes, and decide whether `item.patched` and `part.patched` need more fields (for example message finish and cost) once the timeline store exists.
- Connecting to the user's shared service is allowed (ADR-002). Reading their sessions is fine; never delete or modify existing sessions in tests.
- A failed fetch must never render as an empty list.

## Stop and ask if
- Meeting AC-2 seems to require a state library. Ask before adding one.

## Result

**Status:** review. Implemented on `t012-workbench-timeline` at `c4fe0f2`; not pushed.

### What changed

- **Timeline store** (`packages/core/src/timeline.ts`): normalized by session, item and part id.
  Narrow subscriptions for item order, part membership and one part value; `apply`, `replace`,
  `merge` and `batch`; unknown message/part targets are ignored. Exported from `@mortise/core`.
- **Composition root** (`packages/workbench/src/bootstrap/`): `createGatewayFetch` encodes a DOM
  request into `engine.fetch` and decodes text/base64 replies; `createWorkbenchRuntime` creates the
  adapter, stores, module host and the three modules. It subscribes to `engine.events`,
  `engine.resync` and `connection.changed`, queues translated events to one animation frame, and
  runs the resync procedure: sessions + active ids, pending requests, then the latest page of every
  visible session via `timeline.merge`.
- **Modules** (`packages/workbench/src/modules/`): `sessions` (list, selection, refresh),
  `timeline` (item and part leaves, `StreamingText` subscribed to one part) and `composer` (one
  client message id per attempt, reused by Retry). They communicate through `contract.ts` only.
- **Shell and tokens**: `src/shell.tsx` lays out the three regions; `packages/ui/src/tokens.css`
  has light and dark values, exported as `@mortise/ui/tokens.css`.
- **Adapter fix** (`packages/engine-opencode`): diagnostics now belong to the translator owned by
  `createAdapter`; `resetEventDiagnostics` and module-level counters are gone. Added
  `activeSessions()` for the resync snapshot. Tests create a fresh adapter.
- **Feature docs**: FEAT-004 written in Mode A, then synchronized in Mode D; FEAT-003 synchronized
  for the counter and active-session changes. FEAT-002 Q-001 remains open and is restated as
  FEAT-004 Q-002.

### Verification

- `bun run check`: lint, typecheck, dependency rules and 245 tests pass (8 integration tests
  skipped by design).
- `bun run build`: main, preload and renderer builds succeed.
- `bun run check:deps`: no violations; only `src/bootstrap/` imports the adapter and modules import
  peers only through `contract.ts`.
- AC-1: `bootstrap/timeline-resync.test.ts` replays both recorded versions' turns, applies half or
  all deltas, merges the recorded page, and compares the result with a fresh store. Passes.
- AC-2: `bootstrap/render.test.tsx` applies 2,000 deltas in 40 frame batches to one part. The
  streaming part commits, the sibling item and `SessionsPanel` do not. Passes.
- AC-3: `bootstrap/composer.test.tsx` uses an in-memory channel: the first prompt emits its user
  message then loses the reply, Retry sends the same id, and the timeline holds one user message.
  A second case proves an edited draft gets a new id. Passes.
- AC-4: verified by `bun run check:deps` above.
- AC-5 (manual, isolated): the installed engine is 2.1.2, outside `<2.1.0`, so I started an
  isolated OpenCode 2.0.26 from the Bun cache with `--service`, temporary `XDG_*` directories and
  `OPENCODE_DB`, a scripted provider, and its own `XDG_STATE_HOME`. I seeded one session, then ran
  `bun run dev` with that `XDG_STATE_HOME`. The window reported `live · OpenCode 2.0.26`, listed
  the sandbox session, rendered its user/assistant/tool/final text, and a prompt submitted through
  the composer added the user message and streamed the assistant reply without reloading. I read
  the DOM and captured screenshots through the Electron DevTools protocol. The user's 2.1.2 engine
  and its directories were never stopped, reconfigured or written. The sandbox and process trees
  were stopped and removed afterwards.
  - The run was repeated after the shell was reduced to rendering the views the composition root
    supplies. The second run started from three timeline items, sent another prompt, and finished
    with five items: the new user message and its assistant reply.
  - Environment note: the first `bun run dev` failed with `Error: Electron uninstall` because the
    Electron package postinstall had not downloaded its binary in this worktree. Running the
    package's own `install.js` fixed the local install; no app or sandbox setting was changed.

### Left undone / follow-ups

- Permissions and forms are fetched on resync but not rendered; the panel is out of scope.
- The shell receives its three views from the composition root (DEC-004). A panel registry and a
  shell error boundary are follow-ups; FEAT-004 Q-001 records the open decision.
- Resync reads the latest page, not every loaded page. A streamed message that has fallen out of
  that page could keep a partial part; FEAT-004 RISK-002 records it, and AC-1 covers the recorded
  turn.
- `engine.fetch` query handling was confirmed against the generated client: it serializes query
  values into the URL, so the gateway's `Record<string, string | string[]>` shape covers every
  adapter call. No schema change was needed.
- No extra fields were needed on `item.patched` or `part.patched`; `createdAt` reorders items and
  the tool patch updates state/input/output/metadata/error.

**Suggested commit:** `feat(workbench): stream session timelines through a frame-batched store`

