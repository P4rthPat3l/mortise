---
id: T-007
title: Engine sandbox script and contract fixtures
phase: 0
status: ready
tier: sonnet
depends_on: []
covers: [P2, P7]
assignee: null
started: null
---

# T-007 Engine sandbox script and contract fixtures

## Goal
A script that starts a fully isolated OpenCode engine for tests, and recorded engine responses and event streams that the adapter's contract tests replay. Ideally the sandbox can run a full agent turn deterministically, without a real model provider.

## Read first
- `AGENTS.md`: hard rules 1 and 2
- `docs/opencode/engine-contract.md`: "Agent gotchas", sections 2 and 4
- `opencode serve --help` (flags: `--hostname`, `--port`, `--cors`, `--service`, `--stdio`)
- Upstream, read-only at v2.0.25: `packages/cli/src/env.ts`, `packages/cli/src/database-path.ts`, `packages/schema/src/config/provider.ts`, `packages/simulation/src/backend/simulated-provider.ts`, `packages/simulation/src/backend/openai.ts`

## Scope
1. `scripts/engine-sandbox.ts`: exports `startSandbox({ binary?, version?, port? })` returning `{ url, password, dirs, stop() }`.
   - Runs `opencode serve --hostname 127.0.0.1 --port <free port>` **without** `--service`.
   - Sets `OPENCODE_PASSWORD` to a random value and points `OPENCODE_DB`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` at a fresh temp directory under `.sandbox/` (gitignored).
   - Binary: `bunx @opencode/cli@<version>` with `version` defaulting to `2.0.26`, so runs are reproducible. Option `binary: "installed"` uses `~/.opencode/bin/opencode`, falling back to `opencode` on `PATH`. In every case, run `<binary> --version` first and refuse to start unless the output begins with `opencode v2.`: a v1 binary on `PATH` must fail loudly.
   - Waits until `GET /api/info` with Basic auth returns 200. Kills the process tree on `stop()` and on process exit.
   - Runnable as `bun scripts/engine-sandbox.ts [--version 2.0.20]`: prints the URL and stays up until Ctrl-C.
2. A deterministic model provider. Time box: at most three serious attempts per option. Try in order and record what worked:
   - a. `@opencode/simulation`'s simulated provider, if it can be pointed at by engine config.
   - b. A tiny local OpenAI-compatible server in `scripts/fake-provider.ts` returning a scripted stream (text, one tool call, final text), configured as a custom provider in the sandbox's `opencode.json`.
3. `scripts/record-fixtures.ts [--version 2.0.26]`: starts its own sandbox with `startSandbox`, stops it when done, and records into `packages/engine-opencode/fixtures/<engine-version>/`:
   - `info.json`, `openapi.json`
   - session create, list and get responses; message list for a session
   - `events-turn.jsonl`: every SSE event of one full prompt turn (requires step 2; otherwise record what is possible and say so)
   - `README.md` describing how each file was produced
4. `scripts/engine-sandbox.integration.test.ts`, wrapped in `describe.skipIf(!process.env.MORTISE_INTEGRATION)` so `bun run check` skips it. Scripts live in the `@mortise/scripts` workspace (`scripts/package.json`); delete the placeholder `scripts/index.ts` once real scripts exist.

## Out of scope
Adapter code (T-008), CI wiring (T-014).

## Acceptance criteria
- [ ] AC-1: The integration test starts a sandbox, gets 200 from `/api/info`, stops it, and finds no leftover process.
- [ ] AC-2: The same test proves the user's `~/.local/state/opencode/service.json` is byte-identical before and after.
- [ ] AC-3: Fixtures for the installed engine (2.0.26) are committed. The README says which endpoints and events they cover.
- [ ] AC-4: Either `events-turn.jsonl` exists from a deterministic provider, or Result explains what was tried and why it failed.
- [ ] AC-5: No secret (sandbox password, provider keys) appears in fixtures. Redact before writing.

## Verification
```bash
bun run check
MORTISE_INTEGRATION=1 bun run test scripts/engine-sandbox.integration.test.ts
bun scripts/record-fixtures.ts
```

## Notes and gotchas
- `opencode-ai` on npm is the v1 CLI. Use `@opencode/cli` for pinned v2 versions.
- Without `--service` the engine does not register in `service.json`, so it cannot collide with the user's service.
- Isolated `XDG_CONFIG_HOME` means no user providers or credentials are visible to the sandbox. Keep it that way.
- Fixture files can be large (`openapi.json` is about 20,000 lines). That is acceptable.

## Stop and ask if
- The sandbox would need to read or write anything under the user's real OpenCode directories.
- After the time box, neither provider option works. Record findings and ask; do not hack the engine.

## Result
_Filled in by the agent._
