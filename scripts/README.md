# @mortise/scripts

Development scripts that run under Bun or Node: the isolated engine sandbox, fixture recording and compatibility checks. They are typechecked (`bun run typecheck`) and covered by `bun run check:deps` like any package.

- Scripts may use `@opencode/client` and Node built-ins. They must never import application packages' internals.
- Scripts never touch the user's OpenCode service or directories (AGENTS.md hard rule 2).
- Integration tests here are named `*.integration.test.ts` and skip themselves unless `MORTISE_INTEGRATION=1`.
