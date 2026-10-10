---
id: T-001
title: Domain model v0
phase: 0
status: ready
tier: sonnet
depends_on: []
covers: [P4]
assignee: null
started: null
---

# T-001 Domain model v0

## Goal
`@mortise/domain` exports the client-owned types every layer shares: servers, engine info, connection states, sessions, timeline items, pending requests and domain events. Engine wire formats never leak past the adapter because everything else speaks these types.

## Read first
- `docs/architecture/overview.md`: "Repository mapping", 6.5 State ownership, 6.6 Engine connection state diagram, 6.9 Illustrative contracts
- `docs/opencode/engine-contract.md`: sections 4, 5, 6
- `packages/domain/README.md`
- Upstream concepts, read-only (see AGENTS.md "OpenCode facts"): `packages/schema/src/session.ts`, `session-message.ts`, `session-event.ts`, `permission.ts`, `form.ts` at tag `v2.0.25`
- Reference only, do not copy: OpenChamber's client model, https://github.com/openchamber/openchamber/blob/9ed7e7dddb02d350f26a73ac2e370ee6cb160c11/packages/ui/src/lib/opencode/model.ts

## Scope
Create these files in `packages/domain/src/` and re-export them from `index.ts`:

- `ids.ts`: branded string types `ServerId`, `SessionId`, `MessageId`, `PartId`, `RequestId`, `ProjectId`, each with a constructor function.
- `server.ts`: `ServerRef { id, label, kind: "shared" | "isolated" | "remote", url }`. No credentials, ever.
- `engine.ts`: `EngineCapabilities` (as in overview 6.9), `SupportState = "supported" | "untested" | "unsupported"`, `EngineInfo { version, capabilities, support }`.
- `connection.ts`: `ConnectionState`, a union discriminated by `phase` with exactly the states in the overview 6.6 diagram (`discovering`, `starting`, `no-engine`, `connecting`, `unauthorized`, `incompatible`, `hydrating`, `live`, `resyncing`, `failed`) and the data each needs (for example `incompatible` carries `reason` and the versions involved; `live` carries `EngineInfo`).
- `session.ts`: `SessionSummary` with id, title, project id, directory, created and updated times (epoch ms), activity (`"idle" | "running" | "retrying"`), optional parent id.
- `timeline.ts`: `TimelineItem` (user message, assistant message) and `TimelinePart` (text, reasoning, tool call, shell, compaction, error). A tool call carries a call id, tool name, a state (`pending | running | success | failed`), and `unknown` input and output. Also `TimelinePatch`, the incremental update vocabulary: item added, part added, part text appended (`{ partId, delta }`), part updated, item removed.
- `requests.ts`: `PendingRequest`, a union of a permission request and a form request, each with id, session id, a human title, optional detail, and creation time. Forms carry their questions in a minimal typed shape derived from the upstream form schema.
- `events.ts`: `DomainEvent` as in overview 6.9, plus `connection.changed`.
- Small pure helpers only where they remove real duplication, for example `isTerminalToolState`.

## Out of scope
Zod schemas (T-002), mapping from OpenCode wire types (T-008), any runtime code beyond tiny pure helpers.

## Acceptance criteria
- [ ] AC-1: `packages/domain` has no imports of any package or Node/DOM API (`bun run check:deps` passes).
- [ ] AC-2: Every exported type has JSDoc saying what it represents for the UI and which upstream concept it corresponds to.
- [ ] AC-3: Types describe what the UI needs. They are not copies of OpenCode wire types; no field exists only because the wire has it.
- [ ] AC-4: `ConnectionState` covers every state and transition target in overview 6.6, and a type-level test (`*.test.ts` using `expectTypeOf` from Vitest) proves `phase` is exhaustive.
- [ ] AC-5: Unit tests cover every helper.
- [ ] AC-6: `packages/domain/README.md` lists the exported types in one table.

## Verification
```bash
bun run check
```

## Notes and gotchas
- Times are epoch milliseconds (`number`), as the engine uses.
- Keep tool input and output as `unknown`; the adapter and renderers narrow them.
- Id constructors in `ids.ts` only brand the string. They do not validate; the adapter and the RPC schemas validate at their boundaries.
- `expectTypeOf` assertions do nothing at runtime. They are enforced because `bun run typecheck` compiles test files too (they live under `src/`).
- This is v0. Prefer fewer, clearer types over completeness; later tasks extend it.

## Stop and ask if
- A UI need cannot be expressed without copying a wire type wholesale.
- You want to add a dependency.

## Result
_Filled in by the agent._
