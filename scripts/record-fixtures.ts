// Records engine responses and one full prompt turn into the adapter's fixtures.
//
// Run with `bun scripts/record-fixtures.ts [--version 2.0.26] [--binary installed|bunx|<path>] [--out <dir>]`.
// It starts its own sandbox and its own scripted provider, records the files below,
// then stops both. Fixtures are keyed by the engine's reported version and normalized so
// no absolute sandbox or home path is written (`<sandbox>`, `<repo>`, `<home>`).
//
//   info.json           GET /api/info
//   openapi.json        GET /openapi.json
//   session-create.json POST /api/session
//   session-get.json    GET /api/session/{sessionID}
//   sessions-list.json  GET /api/session
//   messages.json       GET /api/session/{sessionID}/message (after the turn)
//   events-turn.jsonl   every SSE data payload of one prompt turn, one JSON per line
//   README.md           how each file was produced and what it covers
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  DEFAULT_VERSION,
  parseSandboxBinary,
  readVersion,
  resolveInstalledBinary,
  resolveSandboxBinary,
  type SandboxBinary,
  startSandbox,
} from "./engine-sandbox"
import { startFakeProvider } from "./fake-provider"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURES_ROOT = join(REPO_ROOT, "packages", "engine-opencode", "fixtures")
const TURN_TIMEOUT_MS = 60_000

interface Options {
  version: string
  binary?: SandboxBinary
  out?: string
}

async function main(options: Options): Promise<void> {
  const binary = await chooseBinary(options)
  const provider = await startFakeProvider()
  const sandbox = await startSandbox({
    binary,
    version: options.version,
    config: providerConfig(provider.url),
  })

  try {
    const auth = basicAuth(sandbox.password)
    const info = await fetchJson(`${sandbox.url}/api/info`, auth)
    const reportedVersion = asString(asRecord(info)?.version)
    const version = reportedVersion ?? options.version
    const directory = join(options.out === undefined ? FIXTURES_ROOT : resolve(options.out), sanitize(version))
    await mkdir(directory, { recursive: true })
    const replacements = pathReplacements(sandbox.dirs.root)

    const openapi = await fetchText(`${sandbox.url}/openapi.json`, auth)
    const session = await postJson(`${sandbox.url}/api/session`, auth, {})
    const sessionID = asString(asRecord(asRecord(session)?.data)?.id)
    if (sessionID === undefined) throw new Error("session create response did not include an id")

    const sessionGet = await fetchJson(`${sandbox.url}/api/session/${sessionID}`, auth)
    const sessionsList = await fetchJson(`${sandbox.url}/api/session`, auth)
    const events = await collectTurn(sandbox, auth, sessionID)
    const messages = await fetchJson(`${sandbox.url}/api/session/${sessionID}/message`, auth)

    const files: Array<[string, string]> = [
      ["info.json", pretty(info)],
      ["openapi.json", `${openapi.trimEnd()}\n`],
      ["session-create.json", pretty(session)],
      ["session-get.json", pretty(sessionGet)],
      ["sessions-list.json", pretty(sessionsList)],
      ["messages.json", pretty(messages)],
      ["events-turn.jsonl", `${events.map((event) => JSON.stringify(redact(event))).join("\n")}\n`],
    ]
    for (const [name, contents] of files) {
      await writeFile(
        join(directory, name),
        redactText(normalizePaths(contents, replacements), sandbox.password),
        "utf8",
      )
    }
    const readme = renderReadme({ version, binary, eventTypes: uniqueEventTypes(events) })
    await writeFile(
      join(directory, "README.md"),
      redactText(normalizePaths(readme, replacements), sandbox.password),
      "utf8",
    )

    console.log(`wrote ${files.length + 1} files to ${directory}`)
  } finally {
    await sandbox.stop()
    await provider.stop()
  }
}

async function chooseBinary(options: Options): Promise<SandboxBinary> {
  if (options.binary !== undefined) return options.binary
  // An engine installed with npm under `.sandbox/cli-<version>/` fetches only this
  // platform's optional package, unlike `bunx`, so prefer it when it is there.
  const sandboxed = resolveSandboxBinary(options.version)
  if (sandboxed !== undefined) return { path: sandboxed }
  const installed = resolveInstalledBinary()
  if (installed === undefined) return "bunx"
  const installedVersion = await readVersion([installed])
  // Prefer the local binary when it is the exact engine we are recording, so a run
  // does not download the whole CLI. Otherwise pin through `bunx`.
  return installedVersion === options.version ? "installed" : "bunx"
}

function providerConfig(baseURL: string): Record<string, unknown> {
  return {
    update: "disable",
    model: "fake/fake-model",
    providers: {
      fake: {
        name: "Fake provider",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${baseURL}/v1`, apiKey: "fake-provider-key" },
        models: {
          "fake-model": {
            name: "Fake Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100_000, output: 4_096 },
          },
        },
      },
    },
  }
}

async function collectTurn(sandbox: { url: string }, auth: string, sessionID: string): Promise<unknown[]> {
  const events: unknown[] = []
  const controller = new AbortController()
  const response = await fetch(`${sandbox.url}/api/event`, {
    headers: { authorization: auth, accept: "text/event-stream" },
    signal: controller.signal,
  })
  if (response.body === null) throw new Error("event stream had no body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const finished = (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)
        const event = parseEventLine(line)
        if (event !== undefined) {
          events.push(event)
          if (isTurnEnd(event, sessionID)) return
        }
        newline = buffer.indexOf("\n")
      }
    }
  })()

  const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS)
  await postJson(`${sandbox.url}/api/session/${sessionID}/prompt`, auth, {
    text: "List the text files in the working directory.",
  })
  try {
    await finished
  } catch {
    // Aborted by the timeout, or the engine closed the stream. Keep what arrived.
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
  return events
}

function parseEventLine(line: string): unknown | undefined {
  if (!line.startsWith("data:")) return undefined
  const payload = line.slice("data:".length).trim()
  if (payload === "" || payload === "[DONE]") return undefined
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

function isTurnEnd(event: unknown, sessionID: string): boolean {
  const type = asString(asRecord(event)?.type)
  if (type !== "session.execution.succeeded" && type !== "session.execution.failed") return false
  const eventSession = asString(asRecord(asRecord(event)?.data)?.sessionID)
  return eventSession === undefined || eventSession === sessionID
}

function uniqueEventTypes(events: readonly unknown[]): string[] {
  const types = new Set<string>()
  for (const event of events) {
    const type = asString(asRecord(event)?.type)
    if (type !== undefined) types.add(type)
  }
  return [...types].sort()
}

function renderReadme(input: { version: string; binary: SandboxBinary; eventTypes: readonly string[] }): string {
  return `# Engine contract fixtures: ${input.version}

Recorded by \`bun scripts/record-fixtures.ts --version ${input.version}\` against a
private \`opencode serve\` sandbox (\`scripts/engine-sandbox.ts\`, binary: ${binaryLabel(input.binary)}).

The sandbox used a temporary \`OPENCODE_DB\` and temporary \`XDG_*\` directories, ran without
\`--service\`, and was driven by the scripted provider in \`scripts/fake-provider.ts\`. No
upstream model provider or network is involved.

| File | Produced from |
| --- | --- |
| \`info.json\` | \`GET /api/info\` |
| \`openapi.json\` | \`GET /openapi.json\` |
| \`session-create.json\` | \`POST /api/session\` |
| \`session-get.json\` | \`GET /api/session/{sessionID}\` |
| \`sessions-list.json\` | \`GET /api/session\` |
| \`messages.json\` | \`GET /api/session/{sessionID}/message\` after one prompt turn |
| \`events-turn.jsonl\` | \`GET /api/event\`, one JSON event per line, for one full prompt turn |

\`events-turn.jsonl\` starts at \`server.connected\` and ends at
\`session.execution.succeeded\`. It includes the location-initialization events
(\`project.updated\`, \`provider.updated\`, and so on) that arrive after the subscription,
then every event of the prompt turn. Event types observed in this recording:

${input.eventTypes.map((type) => `- \`${type}\``).join("\n")}

## Redaction

The sandbox password and any field named like a credential (\`apiKey\`, \`password\`,
\`authorization\`, \`client_secret\`, access/refresh tokens) are replaced before writing.
The provider key here is a throwaway string for the scripted local provider, not a real
credential.

## Normalization

Absolute paths are replaced before writing so a fixture never carries a machine path: the
sandbox root becomes \`<sandbox>\`, the repository root \`<repo>\`, and the home directory
\`<home>\`. Ids, timestamps and every other value are kept exactly as recorded.
`
}

function binaryLabel(binary: SandboxBinary): string {
  return typeof binary === "object" ? binary.path : binary
}

/**
 * The ordered path substitutions for {@link normalizePaths}. Most specific first: the
 * sandbox lives inside the repository, which lives inside the home directory.
 */
function pathReplacements(sandboxRoot: string): Array<readonly [string, string]> {
  return [
    [sandboxRoot, "<sandbox>"],
    [REPO_ROOT, "<repo>"],
    [homedir(), "<home>"],
  ]
}

function normalizePaths(text: string, replacements: ReadonlyArray<readonly [string, string]>): string {
  let result = text
  for (const [from, to] of replacements) {
    if (from.length > 0) result = result.split(from).join(to)
  }
  return result
}

function sanitize(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function pretty(value: unknown): string {
  return `${JSON.stringify(redact(value), null, 2)}\n`
}

const SECRET_KEY = /^(password|api[-_]?key|authorization|secret|client[-_]?secret|access_?token|refresh_?token)$/i

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  const record = asRecord(value)
  if (record === undefined) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    result[key] = SECRET_KEY.test(key) ? "<redacted>" : redact(item)
  }
  return result
}

function redactText(text: string, password: string): string {
  return password.length > 0 ? text.split(password).join("<redacted>") : text
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

async function fetchJson(url: string, auth: string): Promise<unknown> {
  const response = await fetch(url, { headers: { authorization: auth } })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return response.json()
}

async function fetchText(url: string, auth: string): Promise<string> {
  const response = await fetch(url, { headers: { authorization: auth } })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return response.text()
}

async function postJson(url: string, auth: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`)
  return response.json()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function parseArgs(argv: readonly string[]): Options {
  let version = DEFAULT_VERSION
  let binary: SandboxBinary | undefined
  let out: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--version") version = argv[++index] ?? version
    else if (arg === "--binary") binary = parseSandboxBinary(argv[++index])
    else if (arg === "--out") out = argv[++index]
  }
  return { version, binary, out }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(parseArgs(process.argv.slice(2)))
}
