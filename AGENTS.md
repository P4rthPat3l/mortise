# Mortise agent guide

Mortise is an independent, extensible desktop client for the OpenCode v2 agent engine. The engine runs as a separate process; Mortise talks to it only through public interfaces. "Mortise" is a working name.

**Status:** Phase 0, the walking skeleton. Nothing user-facing works yet. Read this file fully before doing anything.

## Start here

1. Open `tasks/README.md`. Take the first task whose status is `ready` and whose dependencies are all `done`. Read the whole task file.
2. Read only the documents the task links to. Do not load every doc into context. `docs/README.md` is the map.
3. Follow the workflow below. Stop and ask the maintainer whenever the task says so or a rule below says so.

## Repository map

```text
apps/desktop/          Electron host: main (gateway host), sandboxed preload, renderer entry
packages/domain/       Client-owned domain model. Leaf package
packages/rpc-contracts/ Zod schemas and the transport-neutral Channel between UI and gateway
packages/engine-opencode/ Adapter: the only code that understands OpenCode wire formats
packages/gateway-core/ Engine discovery, credentials, event stream, request forwarding. No Electron
packages/core/         Framework-free registries, commands, keybindings, settings, store, event bus
packages/sdk/          Internal module SDK with React bindings, for first-party modules
packages/ui/           Design system: tokens, primitives, themes
packages/workbench/    React UI: shell, composition root (src/bootstrap), feature modules (src/modules)
scripts/               Dev scripts workspace (@mortise/scripts): engine sandbox, fixtures, compatibility checks
docs/                  Architecture, ADRs, engine contract, feature docs, research
tasks/                 The backlog. One file per task
.agents/skills/        Agent skills (feature-documentation). Mirrored for Claude Code in .claude/skills
```

Each package's `README.md` states its responsibility and its allowed and forbidden imports.

## Commands

All commands run from the repository root with Bun 1.4.

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies (Bun workspaces, isolated linker) |
| `bun run check` | Lint, typecheck, dependency rules, tests. Must pass before you finish any task |
| `bun run lint` / `bun run format` | Biome check / Biome autofix |
| `bun run typecheck` | `tsc --noEmit` in every `@mortise/*` package |
| `bun run check:deps` | Architecture boundary rules (`.dependency-cruiser.cjs`) |
| `bun run test` | Vitest, all `*.test.ts(x)` files next to the code |
| `bun run build` | Build the desktop app with electron-vite |
| `bun run dev` | Run the desktop app (opens a window; needs a display) |

If Electron aborts with "The SUID sandbox helper binary was found, but is not configured correctly", the machine needs the one-time AppArmor setup in `README.md` ("Linux: allow Electron's sandbox"). It needs `sudo`, so stop and ask the maintainer. Never pass `--no-sandbox` or disable the sandbox in code.

## Hard rules

These come from the architecture and the ADRs. Breaking one is never a judgment call. If a task seems to require it, stop and ask.

1. **Public engine interfaces only.** Talk to OpenCode through its HTTP API, the `/api/event` SSE stream, PTY WebSockets, plugin RPC, and `@opencode/client`. Never read or write the engine's SQLite database, its data directory layout, or CLI-private files. (ADR-001)
2. **Never disturb the user's engine.** Do not stop, restart, replace or reconfigure the shared OpenCode service, and do not edit `~/.local/state/opencode/` or `~/.config/opencode/`. Tests use an isolated engine with temporary `XDG_*` directories and a temporary `OPENCODE_DB`. (ADR-002)
3. **Credentials stay in the gateway.** The engine password and pairing tokens never reach renderer code, the workbench, or extensions. (C7)
4. **Only the adapter knows OpenCode.** `@opencode/*` may be imported only by `packages/engine-opencode` (Promise root `@opencode/client`) and `packages/gateway-core` (`@opencode/client/service`). Never use `@opencode/client/effect` or `@opencode/client/solid`. (ADR-004)
5. **gateway-core stays host-neutral.** No Electron, React or DOM imports there. It must run under plain Node. (C11)
6. **The event stream is lossy.** Every view must be rebuildable from fresh reads. Never assume you saw every event. (C5)
7. **Send only fields the engine declares.** Request bodies reject unknown fields. (C6)
8. **Extensions never get agent authority.** No API path lets extension code answer permission requests or read credentials. (ADR-011)
9. **Do not weaken guardrails.** Never edit `.dependency-cruiser.cjs`, `biome.json` rules, `tsconfig.base.json` strictness, or disable a lint rule inline, unless the task explicitly says so.
10. **Do not add dependencies** beyond those a task names. Ask first.

## Dependency rules

The allowed import graph, enforced by `bun run check:deps`:

- `domain` imports nothing.
- `rpc-contracts` imports `domain` and `zod`.
- `engine-opencode` imports `domain` and the `@opencode/client` Promise root.
- `gateway-core` imports `domain`, `rpc-contracts`, `@opencode/client/service`, and Node built-ins.
- `core` imports `domain`. `sdk` imports `core`, `domain`, `react`. `ui` imports `react` only.
- `workbench` imports `core`, `sdk`, `ui`, `domain`, `rpc-contracts`, `react`, `react-dom`.
- `scripts` may import `@opencode/client` and Node built-ins, never application package internals. Only `workbench/src/bootstrap/` may import `engine-opencode`.
- A feature module in `workbench/src/modules/<id>/` imports another module only through its `contract.ts`, and never imports `core` directly.
- Electron is imported only in `apps/desktop/src/main` and `apps/desktop/src/preload`.

When a rule blocks you, the design is telling you something. Do not route around it with re-exports. Ask.

## Workflow for a task

1. **Claim it.** In the task file, set `status: in-progress`, `assignee:` your agent name, and `started:` today's date. Update the row in `tasks/README.md`.
2. **Branch.** The base branch is `main`. `git switch main && git switch -c t<NNN>-<short-slug>`, for example `t004-gateway-discovery`. At most three words after the task number.
3. **Design first when the task asks for it.** Tasks that introduce a feature start with a feature document in `docs/features/`, written with the `feature-documentation` skill in Mode A. Read `.agents/skills/feature-documentation/SKILL.md`.
4. **Implement** inside the task's scope. Tests go next to the code as `*.test.ts`.
5. **Verify.** Run every command in the task's Verification section, then `bun run check`. All must pass.
6. **Document.** Update the package `README.md` if its responsibility or API changed. Move the feature document to Mode D (synchronized) if the task implements one. Record new decisions as an ADR (see `docs/adr/README.md`).
7. **Hand back.** Fill in the task's `## Result` section: what changed, how you verified it, anything left undone, follow-up tasks you recommend. Set `status: review` and update the board.
8. **Commit** with Conventional Commits: `type(scope): summary`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Scope is the package or area, for example `feat(gateway-core): discover the shared service`. Push or open a pull request only if the maintainer's instructions for your session say so; otherwise leave the commit on your local branch.

## When to stop and ask the maintainer

- A hard rule or dependency rule is in the way.
- The task needs a new dependency, a new package, or a change to a public contract outside its scope.
- An acceptance criterion cannot be met, or the scope turns out much larger than the task describes.
- Anything touching security: credentials, sandboxing, permissions, network exposure.
- You would have to guess OpenCode behavior. Check `docs/opencode/engine-contract.md` and the upstream source first (see below); if it is still unclear, ask.

Write the question into the task's `## Result` section, set `status: blocked`, and stop.

## Code style

- TypeScript strict. No `any`, no non-null assertions without a comment that proves the invariant, no `@ts-ignore`.
- Named exports only. Default exports only where a tool requires them (config files).
- Validate unknown data once at the boundary that receives it (Zod in `rpc-contracts`, decoders in the adapter), then pass typed values inward.
- Small modules with one responsibility. Inline single-use helpers.
- JSDoc on every exported symbol of a package's public entry point.
- No module-level mutable state in UI code. State belongs to a store or a module instance.
- Comments explain non-obvious constraints, not what the code plainly does.

## Testing

- Unit tests use Vitest and run without network, display, or a real engine.
- Integration tests that need a real engine are named `*.integration.test.ts` and run only when `MORTISE_INTEGRATION=1`. Vitest collects them during `bun run check`, so each file must skip itself: wrap its suites in `describe.skipIf(!process.env.MORTISE_INTEGRATION)(...)`.
- `bun run check` currently passes with zero tests. Every implementation task adds tests. They must start an isolated engine (`scripts/engine-sandbox.ts`, created in T-007), never use the user's shared service except in the read-only coexistence test (T-013).
- Test behavior through public entry points. No mocking of modules you own; inject dependencies (fetch, clock, spawn) instead.

## OpenCode facts and upstream source

- `docs/opencode/engine-contract.md` is the verified reference, with source links. Read its "Agent gotchas" section before any engine work.
- The upstream clone at `/home/parth/Production/opencode` has the **v1** line checked out. Read v2 files without checking out: `git -C /home/parth/Production/opencode show v2.0.25:<path>`.
- The npm package `opencode-ai` is v1. The v2 CLI is `@opencode/cli`.
- Supported engine range: `>=2.0.20 <2.1.0`. The maintainer runs v2.0.26.

## Documentation map

- `docs/README.md`: index of all documentation
- `docs/architecture/overview.md`: the architecture; read its "Repository mapping" section first
- `docs/architecture/extension-system.md`, `docs/architecture/roadmap.md`
- `docs/adr/`: decisions. Never edit an accepted ADR's decision; supersede it
- `docs/features/`: one feature document per feature. Read the relevant one before changing a feature. Index: `docs/features/_index.md`
- `docs/research/`: the full research document (HTML, 170 KB). Read only the section you need
