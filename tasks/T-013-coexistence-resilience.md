---
id: T-013
title: Coexistence and resilience tests
phase: 0
status: todo
tier: sonnet
depends_on: [T-005, T-007, T-008]
covers: [P1, P2]
assignee: null
started: null
---

# T-013 Coexistence and resilience tests

## Goal
Automated proof that Mortise joins an OpenCode service without replacing it, survives another client replacing it, and ends up with correct state after stream loss or an engine restart.

## Read first
- `docs/architecture/roadmap.md`: P1 and P2
- `docs/features/FEAT-001-engine-gateway.md`
- `scripts/engine-sandbox.ts` (T-007), `packages/gateway-core/src/`, `packages/engine-opencode/src/`

## Scope
Integration tests, run only with `MORTISE_INTEGRATION=1`, in `packages/gateway-core/src/*.integration.test.ts` or `scripts/`:
1. **Join without replacing (sandboxed service).** Start an engine with `--service` inside a sandbox with its own `XDG_STATE_HOME`, so it registers in a temporary `service.json`. Point the gateway's discovery at that file. Assert the gateway reaches `live`, and the registration (pid, id, version) is unchanged afterwards.
2. **Survive replacement.** In the same sandbox, start a second `--service` engine (a different version via `bunx @opencode/cli@2.0.20` if available), which replaces the first. Assert the gateway returns to `discovering`, reconnects, and never calls `ensure()` itself.
3. **Read-only check against the real service**, only when `MORTISE_SHARED_SERVICE_TEST=1` is also set: discover the user's service, read `/api/info`, and assert `~/.local/state/opencode/service.json` is byte-identical before and after. No writes of any kind.
4. **Resync correctness.** With the deterministic provider from T-007: run a turn, drop the event stream mid-turn (close the upstream connection) and in a second test restart the engine. After resync, the adapter-built state equals a fresh load of the same session.

## Out of scope
UI tests, performance.

## Acceptance criteria
- [ ] AC-1: Tests 1, 2 and 4 pass locally with `MORTISE_INTEGRATION=1`. Record the command output summary in Result.
- [ ] AC-2: Test 3 passes when explicitly enabled and is skipped otherwise.
- [ ] AC-3: Every test cleans up its processes and temp directories, even on failure.
- [ ] AC-4: If T-007 found no deterministic provider, test 4 uses read-only fixtures to prove resync for session lists, and Result says turn-level resync is still unproven.

## Verification
```bash
bun run check
MORTISE_INTEGRATION=1 bun run test -- integration
```

## Stop and ask if
- Pointing discovery at a temporary registration file needs a change to gateway-core's public API. Propose it first.

## Result
_Filled in by the agent._
