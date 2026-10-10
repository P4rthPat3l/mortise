---
id: T-016
title: Phase 0 exit review and Phase 1 backlog
phase: 0
status: todo
tier: opus
depends_on: [T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013, T-014, T-015]
covers: [P1, P2, P3, P4, P5, P6, P7, P8]
assignee: null
started: null
---

# T-016 Phase 0 exit review and Phase 1 backlog

## Goal
Decide, with evidence, whether Phase 0 proved the architecture, record what changed, and write the Phase 1 backlog.

## Read first
- `docs/architecture/roadmap.md`: P1 to P8 and Phase 1
- Every Phase 0 task's Result section
- `docs/adr/README.md`

## Scope
1. For each of P1 to P8, state pass, fail or partial, with links to the tests or documents that prove it.
2. For each ADR with status `Accepted (validate in Phase 0)`: set it to `Accepted`, or write a superseding ADR when Phase 0 evidence changed the decision.
3. Update `docs/architecture/overview.md` "Repository mapping" and the feature documents (Mode D sync) where code diverged from the design.
4. Write the Phase 1 tasks (minimal client: connection management UI, session list, timeline, composer, permissions and forms, review and diff, terminal, settings, command palette, keybindings, built-in themes, diagnostics) in `tasks/` with the template, and add them to the board.
5. List open risks and questions for the maintainer.

## Acceptance criteria
- [ ] AC-1: `docs/architecture/phase0-review.md` exists with the P1 to P8 table and evidence links.
- [ ] AC-2: No ADR is left in `Accepted (validate in Phase 0)`.
- [ ] AC-3: Phase 1 tasks exist, each fitting one focused session, with dependencies and tiers.

## Verification
```bash
bun run check
```

## Result
_Filled in by the agent._
