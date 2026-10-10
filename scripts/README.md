# @mortise/scripts

Development scripts that run under Bun or Node: the isolated engine sandbox, fixture recording and compatibility checks. They are typechecked (`bun run typecheck`) and covered by `bun run check:deps` like any package.

- Scripts may use `@opencode/client` and Node built-ins. They must never import application packages' internals.
- Scripts never touch the user's OpenCode service or directories (AGENTS.md hard rule 2).
- Integration tests here are named `*.integration.test.ts` and skip themselves unless `MORTISE_INTEGRATION=1`.

## Engine sandbox

`engine-sandbox.ts` starts a private `opencode serve` for tests. It runs without `--service`, points `OPENCODE_DB` and every `XDG_*` directory (plus `HOME`, `TMPDIR` and the working directory) at a fresh tree under `.sandbox/` (gitignored), and scrubs inherited `OPENCODE_*` variables. Nothing outside `.sandbox/` is read or written.

```ts
import { startSandbox } from "./engine-sandbox"

const sandbox = await startSandbox({ binary: "installed" })
// sandbox.url, sandbox.password, sandbox.pid, sandbox.dirs, sandbox.stop()
```

- `binary` defaults to `"bunx"`, which runs `bunx @opencode/cli@<version>` (`version` defaults to `2.0.26`). `"installed"` runs `~/.opencode/bin/opencode`, falling back to `opencode` on `PATH`. `{ path }` runs one executable directly; `resolveSandboxBinary(version)` returns the npm-installed binary under `.sandbox/cli-<version>/` when present, which fetches only this platform's optional package unlike `bunx`.
- Every start runs `<binary> --version` and refuses to continue unless it reports `opencode v2.`, so a v1 binary on `PATH` fails loudly.
- `stop()` kills the whole process tree; the same happens on process exit.

Run `bun scripts/engine-sandbox.ts [--version 2.0.20] [--binary installed]` to start one and keep it up until Ctrl-C.

## Fake provider and fixtures

`fake-provider.ts` is a local OpenAI-compatible chat-completions server with a fixed script (text, one `glob` tool call, final text). It lets the sandbox run a full turn with no real model provider.

`record-fixtures.ts` starts its own sandbox and fake provider and records the engine's responses and one prompt turn into `packages/engine-opencode/fixtures/<version>/`:

```bash
bun scripts/record-fixtures.ts [--version 2.0.26] [--binary installed|bunx|<path>] [--out <dir>]
```

It prefers an npm-installed binary under `.sandbox/cli-<version>/`, then the installed binary when its version matches the requested one, then `bunx`. Credentials (the sandbox password, any `apiKey`/`password`/`authorization`/`secret` field) are redacted before writing, and absolute sandbox, repository and home paths are replaced (`<sandbox>`, `<repo>`, `<home>`) so no recorded fixture carries a machine path. `--out` writes somewhere other than `packages/engine-opencode/fixtures/`, which the nightly workflow uses to record into a temp directory.

To record an older engine without `bunx` fetching every platform's binary:

```bash
npm install --prefix .sandbox/cli-2.0.20 @opencode/cli@2.0.20
bun scripts/record-fixtures.ts --version 2.0.20
```

## OpenAPI compatibility diff

`diff-openapi.ts` compares two recorded `openapi.json` files and prints removed and added operations plus per-operation request-body fields that were removed or newly required. It exits 1 when something the adapter calls was removed or changed incompatibly, 2 on bad usage. The nightly workflow records the latest engine and diffs it against the newest committed fixtures; a failing exit is the signal.

```bash
bun scripts/diff-openapi.ts packages/engine-opencode/fixtures/2.0.20/openapi.json packages/engine-opencode/fixtures/2.0.26/openapi.json
```

The adapter's contract tests replay every fixture directory under `packages/engine-opencode/fixtures/<version>/`, so one `bun run test` runs them once per supported engine version.
