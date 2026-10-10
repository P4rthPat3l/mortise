---
id: T-003
title: FEAT-001 engine gateway feature document
phase: 0
status: review
tier: sonnet
depends_on: []
covers: [P1, P2, P3]
assignee: deepseek-v4.1-flash
started: 2026-10-10
---

# T-003 FEAT-001 engine gateway feature document

## Goal
A Mode A (pre-implementation) feature document for the engine gateway that T-004, T-005, T-006 and T-009 implement against. It fixes behavior as testable rules so implementing agents do not have to make design calls.

## Read first
- `.agents/skills/feature-documentation/SKILL.md`, then `templates/feature-full.md` and `examples/FEAT-014-payment-processing.md`
- `docs/opencode/engine-contract.md`: "Agent gotchas", sections 2, 3, 4, and 13.2, 13.3, 13.6
- `docs/architecture/overview.md`: "Repository mapping", 6.2, 6.6, 6.7, 6.10
- ADRs 0002, 0003, 0012
- Upstream, read-only at tag v2.0.25: `packages/client/src/promise/service.ts`, `packages/client/src/service-probe.ts`, `packages/client/src/solid/connection.ts`, `packages/server/src/event-feed.ts`, `packages/server/src/handlers/event.ts`, `packages/desktop/src/main/service/background-service.ts`

## Scope
Create `docs/features/FEAT-001-engine-gateway.md` from the full template and add its row to `docs/features/_index.md`. It must cover:

- Connection state machine with every transition and its trigger (Mermaid `stateDiagram-v2`), matching overview 6.6.
- Discovery and start policy as business rules, for example: BR "never pass a version to `ensure()`", BR "never stop or replace the shared service", BR "start the service only when none is registered and the user's CLI is installed".
- Version and capability detection, with the supported range `>=2.0.20 <2.1.0` and the highest tested version as a constant.
- Event stream: one subscription per server; `server.connected` first; 45 s idle watchdog; reconnect backoff; generation counter; `engine.resync` before forwarded events; batching interval; fan-out to many windows.
- Request forwarding: path allowlist, header rules, Basic auth injection, binary bodies, error mapping, 401 handling.
- Security rules (SEC-*): credentials never cross the channel, nothing secret in logs.
- Sequence diagrams: startup and resync (adapt overview 6.7).
- The channel contract, referencing `@mortise/rpc-contracts` method names from T-002.
- Test plan, and an implementation plan whose phases map to T-004, T-005, T-006 and T-009.
- Open questions you could not resolve from the sources.

## Out of scope
Code. Isolated-engine mode and remote pairing beyond a short "later" note.

## Acceptance criteria
- [x] AC-1: The skill's quality gate (`checklists/quality-gate.md`) blocking checks pass. Record the results in Result.
- [x] AC-2: Every claim is labeled `Planned`, `Inferred` or `Unknown`. Nothing is labeled `Current`, since no code exists.
- [x] AC-3: Every business rule, acceptance criterion and security rule has a stable ID that T-004 to T-006 can cite.
- [x] AC-4: Every OpenCode behavior the document relies on links to `docs/opencode/engine-contract.md` or to an upstream file at v2.0.25.
- [x] AC-5: The index row exists.

## Verification
```bash
bun run check
```
Then confirm by reading that no table `Status` cell and no inline claim uses the label `Current`. The word may still appear in the template's own explanatory text.

## Notes and gotchas
- Status axes: frontmatter `status: proposed` (only the maintainer moves it to `approved`), `implementation_status: not_started`, `last_verified_commit: null`.
- Design decisions local to the gateway go in the document's Decisions section as `DEC-*` entries. Write an ADR only for a decision that affects other modules or changes an existing ADR, and then stop and ask first.
- Do not invent latency targets or metric names. Leave unknowns as Open Questions.

## Stop and ask if
- The sources contradict each other on engine behavior.
- A rule would require changing an ADR.

## Result

### What changed

- Created `docs/features/FEAT-001-engine-gateway.md`, a Mode A (pre-implementation) full-template feature document for the engine gateway.
- Added the FEAT-001 row to `docs/features/_index.md` and removed the "no feature documents exist yet" note.

### Document contents

- Connection state machine (`stateDiagram-v2`) with all 16 transitions and triggers, matching overview 6.6, plus a state table.
- Business rules BR-001 to BR-026 covering discovery and start policy, version/capability detection, the event stream, and forwarding.
- Acceptance criteria AC-001 to AC-011 and edge cases CASE-001 to CASE-014, each mapped to the task that will implement or test it.
- Security rules SEC-001 to SEC-006; operational requirements OPS-001 to OPS-006 with only sourced targets.
- Two sequence diagrams (startup, resync) adapted from overview 6.7, a system context diagram, a control flow diagram and an `erDiagram`.
- Channel contract referencing the exact `@mortise/rpc-contracts` method and event names from T-002 (`servers.list`, `connection.get`, `engine.fetch`; `connection.changed`, `engine.events`, `engine.resync`).
- Decisions DEC-001 to DEC-007 (all restating existing ADRs, none changing one) and open questions Q-001 to Q-006.
- Implementation plan with four phases mapped to T-004, T-005, T-006 and T-009.

Status axes: `status: proposed`, `implementation_status: not_started`, `last_verified_commit: null`. Every claim is `Planned`, `Inferred` (upstream engine facts) or `Unknown`. Nothing is `Current`.

### Verification

- `bun run check` — passed: Biome 42 files clean, typecheck all 10 packages, `check:deps` no violations (21 modules), Vitest no test files (expected).
- Task Verification step 2 (read): no table `Status` cell and no inline claim uses `Current`. The only occurrences are the frontmatter comment, the status legend that defines the word and marks it unused, and the standard `### Current Limitations` heading.

### Quality gate (AC-1, Tier 1 blocking checks)

- B1 no placeholders — clean.
- B2 every `Current` path exists — no `Current` claim; the three §11 Existing paths (`packages/gateway-core/src/index.ts`, `packages/rpc-contracts/src/index.ts`, `packages/domain/src/index.ts`) all exist.
- B3 verification commit — `null`, and no claim is `Current`.
- B4 drift — not applicable (`last_verified_commit: null`).
- B5 validation commands real — `check`, `test`, `typecheck`, `check:deps` all exist in `package.json`.
- B6 rules traceable — every BR, AC and SEC row is explicitly marked `Untested; planned in T-00X`.
- B7 diagrams — six mermaid blocks (two `flowchart`, two `sequenceDiagram`, one `stateDiagram-v2`, one `erDiagram`), each with the type on its first line and explanatory prose.
- B8 status vocabulary — frontmatter/implementation axes clean; table `Status` cells use only `Planned`/`Inferred`/`Unknown`.
- B9 discoverable — index row added and `AGENTS.md` points at `docs/features/`.

### Left undone / follow-ups

- Open questions Q-001 to Q-006 need maintainer answers; Q-001 (who owns `hydrating` → `live`) is the only one that could affect T-004's interface, the rest are local.
- Doc remains `proposed`; only the maintainer moves it to `approved`.

### Commit

`docs(gateway): add FEAT-001 engine gateway feature document`
