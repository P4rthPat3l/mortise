# Engine contract fixtures: 2.0.26

Recorded by `bun scripts/record-fixtures.ts --version 2.0.26` against a
private `opencode serve` sandbox (`scripts/engine-sandbox.ts`, binary: installed).

The sandbox used a temporary `OPENCODE_DB` and temporary `XDG_*` directories, ran without
`--service`, and was driven by the scripted provider in `scripts/fake-provider.ts`. No
upstream model provider or network is involved.

| File | Produced from |
| --- | --- |
| `info.json` | `GET /api/info` |
| `openapi.json` | `GET /openapi.json` |
| `session-create.json` | `POST /api/session` |
| `session-get.json` | `GET /api/session/{sessionID}` |
| `sessions-list.json` | `GET /api/session` |
| `messages.json` | `GET /api/session/{sessionID}/message` after one prompt turn |
| `events-turn.jsonl` | `GET /api/event`, one JSON event per line, for one full prompt turn |

`events-turn.jsonl` starts at `server.connected` and ends at
`session.execution.succeeded`. It includes the location-initialization events
(`project.updated`, `provider.updated`, and so on) that arrive after the subscription,
then every event of the prompt turn. Event types observed in this recording:

- `agent.updated`
- `command.updated`
- `integration.updated`
- `model.updated`
- `plugin.updated`
- `project.updated`
- `provider.updated`
- `reference.updated`
- `server.connected`
- `session.execution.started`
- `session.execution.succeeded`
- `session.inbox.delivered`
- `session.inbox.enqueued`
- `session.instructions.updated`
- `session.renamed`
- `session.step.ended`
- `session.step.started`
- `session.step.streamed`
- `session.text.delta`
- `session.text.ended`
- `session.text.started`
- `session.tool.called`
- `session.tool.input.ended`
- `session.tool.input.started`
- `session.tool.success`
- `session.usage.updated`
- `skill.updated`
- `vcs.branch.updated`
- `websearch.updated`

## Redaction

The sandbox password and any field named like a credential (`apiKey`, `password`,
`authorization`, `client_secret`, access/refresh tokens) are replaced before writing.
The provider key here is a throwaway string for the scripted local provider, not a real
credential.
