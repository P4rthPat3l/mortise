# Backlog

One file per task. Agents: read `AGENTS.md` first, then pick the first task below whose status is `ready` and whose dependencies are all `done`.

## Statuses

`todo` (dependencies not done) · `ready` (can start now) · `in-progress` · `review` (done by the agent, awaiting maintainer) · `blocked` (question in the task's Result section) · `done` (maintainer accepted)

When you finish a task, set it to `review`, never `done`. When a task moves to `done`, promote every task whose dependencies are now all `done` from `todo` to `ready`.

## Model tier

Each task names the cheapest model tier expected to do it well:

- **haiku**: mechanical work with an exact spec and little judgment
- **sonnet**: normal implementation with tests and some design judgment
- **opus**: design-defining, security-critical, or open-ended research; or a final review

A cheaper tier may try a harder task, but must stop and ask when a judgment call exceeds the spec.

## Phase 0: walking skeleton

Goal: prove the decisions that are hardest to reverse (P1 to P8 in `docs/architecture/roadmap.md`) before product work starts.

| ID | Title | Tier | Depends on | Covers | Status |
| --- | --- | --- | --- | --- | --- |
| T-000 | Repository bootstrap | opus | none | | done |
| [T-001](T-001-domain-model.md) | Domain model v0 | sonnet | none | P4 | done |
| [T-002](T-002-rpc-contracts.md) | RPC contracts and Channel v0 | sonnet | T-001 | P3 | done |
| [T-003](T-003-gateway-feature-doc.md) | FEAT-001 engine gateway feature document | sonnet | none | P1, P2, P3 | done |
| [T-004](T-004-gateway-discovery.md) | Gateway: discovery and connection state machine | sonnet | T-001, T-002, T-003 | P1 | done |
| [T-005](T-005-gateway-events.md) | Gateway: event stream, batching and resync | sonnet | T-004 | P2, P3 | done |
| [T-006](T-006-gateway-forwarding.md) | Gateway: authenticated request forwarding | sonnet | T-002, T-004 | P3 | ready |
| [T-007](T-007-engine-sandbox.md) | Engine sandbox script and contract fixtures | sonnet | none | P2, P7 | done |
| [T-008](T-008-engine-adapter.md) | Engine adapter v0 | sonnet | T-001, T-007 | P4 | done |
| [T-009](T-009-desktop-gateway-host.md) | Desktop gateway host and MessagePort channel | sonnet | T-002, T-004, T-005, T-006 | P3 | todo |
| [T-010](T-010-core-services.md) | Core: registries, commands, keybindings, settings, store | sonnet | T-001 | P5 | done |
| [T-011](T-011-module-sdk.md) | Module SDK and FEAT-002 | sonnet | T-010 | P5 | done |
| [T-012](T-012-workbench-timeline.md) | Workbench composition root and streaming timeline | sonnet | T-008, T-009, T-011 | P3, P4, P8 | todo |
| [T-013](T-013-coexistence-resilience.md) | Coexistence and resilience tests | sonnet | T-005, T-007, T-008 | P1, P2 | ready |
| [T-014](T-014-version-matrix.md) | Engine version matrix in CI | haiku | T-007, T-008 | P7 | done |
| [T-015](T-015-extension-sandbox-spike.md) | Sandboxed extension spike | opus | T-009 | P6 | todo |
| [T-016](T-016-phase0-exit-review.md) | Phase 0 exit review and Phase 1 backlog | opus | T-001 to T-015 | P1 to P8 | todo |

## Parallel tracks

Three agents can work at once without touching the same files:

- **Gateway:** T-003 → T-004 → T-005 and T-006 → T-009
- **Engine:** T-007 → T-008 → T-014
- **Core:** T-001 → T-002 and T-010 → T-011

They join at T-012, T-013 and T-015. T-016 closes the phase.

T-002 sits on the Core track but blocks the Gateway track (T-004, T-006). Whoever finishes T-001 should take T-002 next.

T-000 is the bootstrap that created this repository. It has no task file.

## Writing a new task

Copy `TEMPLATE.md`, take the next unused number, fill every section, and add a row above. A good task fits in one focused session, names its files, and has acceptance criteria a reviewer can check by running commands.
