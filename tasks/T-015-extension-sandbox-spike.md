---
id: T-015
title: Sandboxed extension spike
phase: 0
status: ready
tier: opus
depends_on: [T-009]
covers: [P6]
assignee: null
started: null
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
- [ ] AC-1: `docs/research/2026-MM-DD-extension-sandbox-spike.md` reports every measurement and attack check with its method.
- [ ] AC-2: The document recommends sandboxed iframes or `WebContentsView` per extension, with reasons, and lists any ADR or architecture change needed.
- [ ] AC-3: `bun run check` still passes. Spike code is excluded from production entry points or behind a dev-only flag.

## Verification
```bash
bun run check
```

## Stop and ask if
- An attack check succeeds. Stop, write it down, and report before continuing.

## Result
_Filled in by the agent._
