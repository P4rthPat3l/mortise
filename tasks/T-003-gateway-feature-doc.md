---
id: T-003
title: FEAT-001 engine gateway feature document
phase: 0
status: ready
tier: sonnet
depends_on: []
covers: [P1, P2, P3]
assignee: null
started: null
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
- [ ] AC-1: The skill's quality gate (`checklists/quality-gate.md`) blocking checks pass. Record the results in Result.
- [ ] AC-2: Every claim is labeled `Planned`, `Inferred` or `Unknown`. Nothing is labeled `Current`, since no code exists.
- [ ] AC-3: Every business rule, acceptance criterion and security rule has a stable ID that T-004 to T-006 can cite.
- [ ] AC-4: Every OpenCode behavior the document relies on links to `docs/opencode/engine-contract.md` or to an upstream file at v2.0.25.
- [ ] AC-5: The index row exists.

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
_Filled in by the agent._
