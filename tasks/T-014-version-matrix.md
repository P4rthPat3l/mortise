---
id: T-014
title: Engine version matrix in CI
phase: 0
status: todo
tier: haiku
depends_on: [T-007, T-008]
covers: [P7]
assignee: null
started: null
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
- [ ] AC-1: `bun run test` runs the adapter contract tests once per fixture version, and both pass.
- [ ] AC-2: `bun scripts/diff-openapi.ts packages/engine-opencode/fixtures/2.0.20/openapi.json packages/engine-opencode/fixtures/2.0.26/openapi.json` prints a readable report.
- [ ] AC-3: The nightly workflow is valid YAML and uses only `oven-sh/setup-bun` and `actions/checkout`.
- [ ] AC-4: `rg -l "/home/" packages/engine-opencode/fixtures` finds nothing.

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
_Filled in by the agent._
