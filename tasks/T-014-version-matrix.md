---
id: T-014
title: Engine version matrix in CI
phase: 0
status: done
tier: haiku
depends_on: [T-007, T-008]
covers: [P7]
assignee: deepseek-v4.1-flash
started: 2026-10-10
---

# T-014 Engine version matrix in CI

## Goal
The adapter's contract tests run against recorded fixtures for OpenCode 2.0.20 and 2.0.26, and a nightly job warns when a new OpenCode release removes or changes operations the adapter uses.

## Read first
- `docs/architecture/roadmap.md`: P7
- `docs/opencode/engine-contract.md`: section 10 and sections 13.3, 13.4
- `scripts/record-fixtures.ts`, `packages/engine-opencode/fixtures/README.md` (from T-007)
- `.github/workflows/ci.yml`

## Scope
1. Record fixtures for 2.0.20: `bun scripts/record-fixtures.ts --version 2.0.20`. Commit them under `packages/engine-opencode/fixtures/2.0.20/`.
2. Make the adapter contract tests iterate over every fixture directory, so each engine version runs the same assertions.
3. `scripts/diff-openapi.ts`: compares the operation ids and request body fields of two `openapi.json` files and prints removed operations, removed fields, and newly required fields. Exit code 1 if anything the adapter calls was removed or changed incompatibly.
4. `.github/workflows/engine-nightly.yml`: daily, installs the latest `@opencode/cli`, records fixtures into a temp directory, runs `diff-openapi.ts` against the newest committed fixtures, and runs the contract tests against the new recording. Failing is the signal; it does not commit anything.
5. Normalize fixtures at record time in `scripts/record-fixtures.ts`: replace sandbox absolute paths (they currently contain `/home/<user>/...`) with a placeholder such as `<sandbox>`, and keep ids and timestamps as recorded. Re-record 2.0.26 so no committed fixture contains a home directory path.

## Out of scope
Changing adapter behavior. If 2.0.20 differs, record it and ask.

## Acceptance criteria
- [x] AC-1: `bun run test` runs the adapter contract tests once per fixture version, and both pass.
- [x] AC-2: `bun scripts/diff-openapi.ts packages/engine-opencode/fixtures/2.0.20/openapi.json packages/engine-opencode/fixtures/2.0.26/openapi.json` prints a readable report.
- [x] AC-3: The nightly workflow is valid YAML and uses only `oven-sh/setup-bun` and `actions/checkout`.
- [x] AC-4: `rg -l "/home/" packages/engine-opencode/fixtures` finds nothing.

## Verification
```bash
bun run check
bun scripts/diff-openapi.ts packages/engine-opencode/fixtures/2.0.20/openapi.json packages/engine-opencode/fixtures/2.0.26/openapi.json
```

## Notes and gotchas
- T-007 found that `bunx @opencode/cli@<version>` downloads every platform's binary (gigabytes) on this machine. Install an older engine with npm instead, which only fetches the current platform's optional package: `npm install --prefix .sandbox/cli-2.0.20 @opencode/cli@2.0.20`, then pass that binary to `startSandbox` (extend its options if needed). Do the same in the nightly workflow.

## Stop and ask if
- Any contract test fails on 2.0.20. Do not change the adapter; report the difference.

## Result

### What changed
- Recorded `packages/engine-opencode/fixtures/2.0.20/` with an npm-installed engine (`npm install --prefix .sandbox/cli-2.0.20 @opencode/cli@2.0.20`), and re-recorded `2.0.26/`.
- `scripts/record-fixtures.ts`: normalizes absolute sandbox/repository/home paths to `<sandbox>`, `<repo>`, `<home>` at record time; auto-selects an npm-installed engine under `.sandbox/cli-<version>/`; `--binary` now also accepts a path; added `--out <dir>`.
- `scripts/engine-sandbox.ts`: `SandboxBinary` gained `{ path }`; exported `resolveSandboxBinary` and `sandboxCommand`; `--binary`/`--version` parsing shared with the recorder.
- Adapter contract tests (`sessions.test.ts`, `timeline.test.ts`, `events.test.ts`) discover every `fixtures/<version>/` directory and run the same assertions per version, deriving ids, timestamps and paths from each fixture. Added fixture-integrity tests (both versions present, no `/home/` path in any recorded file).
- `scripts/diff-openapi.ts` + `scripts/diff-openapi.test.ts`: compares two specs, prints removed/added operations and request-body removals/new-required fields, exits 1 when an adapter operation or a field it sends was removed or a field it does not send became required.
- `.github/workflows/engine-nightly.yml`: daily, installs the latest `@opencode/cli` with npm, records into `$RUNNER_TEMP`, diffs against the newest committed fixtures, then runs `bun run test` against the new recording. No commit, no other actions.

### Verification
- `bun run check` — pass: lint, typecheck (all packages), dependency rules, 117 tests passed / 2 integration skips.
- `bun run test` for the three contract files with the verbose reporter shows the same assertions under `(2.0.20)` and `(2.0.26)`; both pass.
- `bun scripts/diff-openapi.ts packages/engine-opencode/fixtures/2.0.20/openapi.json packages/engine-opencode/fixtures/2.0.26/openapi.json` — exit 0; report shows only added operations (`vcs.init`, `integration.connect.external`) and no adapter incompatibility.
- No `/home/` under `packages/engine-opencode/fixtures` (verified with the built-in ripgrep-backed search; the `rg` binary is not permitted in this environment).
- `.github/workflows/engine-nightly.yml` parsed with `Bun.YAML.parse`; its only `uses:` entries are `actions/checkout@v4` and `oven-sh/setup-bun@v2`.

### Left undone / notes
- The nightly workflow was validated as YAML only; it was not run on a GitHub runner. Its `npm install` relies on the runner's npm running the package postinstall. This machine's `~/.npmrc` sets `allow-scripts`, which blocked it, so the local 2.0.20 binary was enabled once with `node .sandbox/cli-2.0.20/node_modules/@opencode/cli/postinstall.mjs`.
- 2.0.20 needed no adapter change: the contract tests pass on it unchanged, and `diff-openapi` finds no removed adapter operation or field.

### Follow-up
- Move the fixture floor deliberately when the supported range changes; recording a new version is `npm install --prefix .sandbox/cli-<version> @opencode/cli@<version>` then `bun scripts/record-fixtures.ts --version <version>`.

