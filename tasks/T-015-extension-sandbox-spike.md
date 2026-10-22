---
id: T-015
title: Sandboxed extension spike
phase: 0
status: done
tier: opus
depends_on: [T-009]
covers: [P6]
assignee: opencode
started: 2026-10-22
---

# T-015 Sandboxed extension spike

## Goal
Evidence, not product code: does a third-party view in a sandboxed iframe with a strict CSP, talking to the host only through a postMessage bridge, give the isolation and performance the extension design assumes? The output is a findings document with a recommendation.

## Read first
- `docs/architecture/extension-system.md`: 7.1, 7.5, 7.6, 7.10, 7.11, 7.12
- ADRs 0009 and 0011
- OpenChamber's frame policy, for comparison: https://github.com/openchamber/openchamber/blob/9ed7e7dddb02d350f26a73ac2e370ee6cb160c11/packages/sdk/src/frame-policy.ts

## Scope
All spike code lives in `apps/desktop/src/spikes/extension-sandbox/` and in a clearly marked debug panel. It is allowed to be thrown away.
1. Register a privileged `mortise-ext` scheme in main that serves files from a sample extension folder with a `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'` header.
2. Host a view in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`).
3. A postMessage JSON-RPC bridge with a versioned envelope and three calls: `commands.register`, `notify`, and `network.fetch` (always denied: no `network` capability).
4. One declarative tool-call renderer from a manifest entry, rendered by the host with no extension code.
5. Measurements, written down with method and numbers:
   - Is the iframe in its own renderer process? Use `app.getAppMetrics()` and the frame's `processId`.
   - Memory per additional frame (1, 5, 10 frames).
   - Bridge round-trip latency (median and p95 over 1,000 calls).
6. Attack checks, each attempted and reported: `fetch` to a remote URL; reading `parent.document`; `top.location` navigation; `window.open`; posting a forged message that claims to come from the host; a path traversal request to the scheme handler.

## Out of scope
The real extension host, manifest loader, capability broker or public API (Phase 3).

## Acceptance criteria
- [x] AC-1: `docs/research/2026-MM-DD-extension-sandbox-spike.md` reports every measurement and attack check with its method.
- [x] AC-2: The document recommends sandboxed iframes or `WebContentsView` per extension, with reasons, and lists any ADR or architecture change needed.
- [x] AC-3: `bun run check` still passes. Spike code is excluded from production entry points or behind a dev-only flag.

## Verification
```bash
bun run check
```

## Stop and ask if
- An attack check succeeds. Stop, write it down, and report before continuing.

## Result

**Status: review.** All six attack checks were attempted and blocked. No stop condition was hit.

### What changed

- `apps/desktop/src/spikes/extension-sandbox/` contains the disposable spike:
  - `main/scheme.ts` serves `mortise-ext://acme.tasks/` with the required CSP, strict path resolution and symlink rejection. `scheme.test.ts` covers traversal, symlink escape, malformed encoding, wrong host and the normal file path.
  - `main/spike.ts` drives the measurements and attack checks and writes one JSON report. It imports no Electron module; `src/main/index.ts` supplies the process metrics, frame list, `net.fetch` and console messages.
  - `shared/envelope.ts` is the versioned envelope with exactly three calls: `commands.register`, `notify` and `network.fetch`. `envelope.test.ts` covers wrong version, wrong direction, unknown call and malformed params.
  - `renderer/panel.ts` is the host half of the bridge, the debug panel and the host-rendered tool-call table. `renderer/tool-call.ts` interprets the manifest contribution; `tool-call.test.ts` covers glob matching, title substitution and table cells.
  - `sample-extension/` is the view and its manifest (commands, view, `toolRenderers`).
- `apps/desktop/src/renderer/spike.html` is the dev-only host page. It carries `frame-src mortise-ext://acme.tasks`; the production renderer CSP is unchanged.
- `apps/desktop/electron.vite.config.ts` adds the spike renderer entry only when `MORTISE_SPIKE_BUILD=1`.
- `apps/desktop/src/main/index.ts` registers the scheme, serves the package, skips the gateway in spike mode, uses its own `userData` directory and runs the driver. Activation requires `!app.isPackaged` plus `MORTISE_SPIKE=extension-sandbox`.
- `docs/research/2026-10-22-extension-sandbox-spike.md` is the findings document: method, numbers, attack evidence, recommendation, ADR/architecture notes and limitations.
- `docs/architecture/extension-system.md` §7.10 replaces the process-isolation open question with the measured result and adds the `frame-src` and `event.source` requirements; §7.11 records the measured iframe cost.

### Measurements (primary run, Electron 44.7.0 / Chromium 152 / Linux x64)

- **Process isolation:** host renderer OS pid 905959, extension frame OS pid 906141. One frame and ten frames were in a process separate from the host; all ten same-origin frames shared one extension process. `WebFrameMain.processId` was 5 for the frame versus 4 for the host, so both the Chromium id and the OS pid are recorded in the report.
- **Memory:** 0 frames 0 KiB extension / 112,076 KiB host; 1 frame 108,560 KiB; 5 frames 112,868 KiB; 10 frames 119,012 KiB. Fixed process cost is about 106 MiB; extra frames cost 1.0–1.5 MiB each. A repeat run measured 108,060 / 114,156 / 119,064 KiB.
- **Bridge latency:** 1,000 calls after 50 warmup, median 0.2 ms, p95 0.3 ms, p99 0.4 ms, mean 0.212 ms, max 4.1 ms. Repeat: median 0.2 ms, p95 0.3 ms, p99 0.5 ms, max 4.5 ms. This is the renderer-to-renderer `postMessage` hop, not a capability call that reaches main.
- **Bridge calls:** `network.fetch` returned `capability_denied`; the host made no request.

### Attack checks

- Remote `fetch`: blocked by CSP `connect-src 'none'`; local sink received zero requests; console recorded the CSP violation.
- `parent.document`: blocked by the opaque origin (`SecurityError`, frame origin `"null"`).
- `top.location`: blocked by the sandbox without `allow-top-navigation`; both URLs unchanged after 750 ms.
- `window.open`: returned `null`, window count unchanged, sandbox console message recorded.
- Forged host message: rejected by direction plus `event.source`; accepted calls stayed 1071, `wrong-direction` went 0 → 1, forged notification not delivered.
- Path traversal: encoded traversal returned 403, encoded absolute and double-encoded returned 404, a normalized `%2e%2e/` stayed inside the package root, wrong host returned 404, and the outside canary was never read. Unit tests also cover a symlink escape (403).

### Verification

- `bun run check` exit code 0: lint, typecheck, dependency rules and all tests pass (34 files passed, 3 skipped; 227 tests passed, 8 skipped). The spike adds 13 unit tests.
- `MORTISE_SPIKE_BUILD=1 bun run build` produced `out/renderer/spike.html`; a normal build does not include it.
- Two full spike runs completed with exit code 0; reports at `/tmp/opencode/t015/report3.json` and `report4.json`.
- Display confirmed (`DISPLAY=:0`); the spike used a separate `userData` directory, so the single-instance lock did not collide with another worktree's app.

### Recommendation

Use sandboxed iframes per T1 view as the default. Host isolation and cost are both acceptable. Keep `WebContentsView` for cross-extension process isolation if a two-id measurement shows shared processes, and for web embeds. No new ADR is required; ADR-0009's choice is validated.

### Not done / follow-ups

- Cross-extension process isolation was not measured. A follow-up with two extension ids should repeat the frame-process check before the design claims extension-to-extension isolation.
- The latency number excludes the main-process capability hop. A phase-3 benchmark should measure a real `sessions.current()`-style call end to end.
- Manifest discovery, capability approval, storage and updates remain Phase 3/out of scope.
- The production workbench renderer will need a narrow `frame-src` allowance when it hosts extension views; this spike deliberately kept that in the dev-only page.
- No feature document was created: this is throwaway spike code, and the findings settle the existing §7.10 open question.

### Commit

`a9a0520` `chore(desktop): add sandboxed extension iframe spike` (implementation). This Result, the research document and the architecture update follow in the docs commit on the same branch.
