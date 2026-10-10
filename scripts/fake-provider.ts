// A tiny OpenAI-compatible chat-completions server that answers with a fixed script.
//
// It exists so the engine sandbox can run a full agent turn without a real model
// provider or network. The script is decided by the request, not by wall-clock time
// or hidden state, so repeated turns produce the same event sequence:
//   1. the engine's title request carries no tools, so it gets plain text;
//   2. the main request carries tools, so it gets a short text delta plus one `glob`
//      tool call (the safest engine tool: read-only and auto-allowed);
//   3. the follow-up request carries the tool result, so it gets the final text.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Text streamed before the tool call. Chosen so the derived session title is stable. */
const OPENING = "Let me look. "
/** Text streamed once the tool result comes back. */
const CLOSING = "Sandbox turn complete."
/** The only tool the script invokes. */
const TOOL_NAME = "glob"
const TOOL_ARGUMENTS = JSON.stringify({ pattern: "*.txt" })
const DONE = "data: [DONE]\n\n"

export interface FakeProviderOptions {
  /** Loopback port. A free port is chosen when omitted. */
  port?: number
}

export interface FakeProvider {
  url: string
  port: number
  /** Stops the server. Safe to call more than once. */
  stop: () => Promise<void>
}

/** Starts the scripted provider and resolves once it is listening. */
export async function startFakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const server = createServer((request, response) => void handle(request, response))
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  return { url: `http://127.0.0.1:${port}`, port, stop: () => close(server) }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "not found" } }))
    return
  }
  const body = await readBody(request)
  const messages = asArray(asRecord(body)?.messages)
  const tools = asArray(asRecord(body)?.tools)
  const hasToolResult = messages.some((message) => asRecord(message)?.role === "tool")
  const toolNames = tools.flatMap((tool) => {
    const name = asRecord(asRecord(tool)?.function)?.name
    return typeof name === "string" ? [name] : []
  })

  response.writeHead(200, { "content-type": "text/event-stream" })
  const firstTool = toolNames[0]
  if (!hasToolResult && firstTool !== undefined) {
    const name = toolNames.includes(TOOL_NAME) ? TOOL_NAME : firstTool
    response.write(frame({ choices: [{ index: 0, delta: { role: "assistant", content: OPENING } }] }))
    response.write(
      frame({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_fake_1", type: "function", function: { name, arguments: TOOL_ARGUMENTS } },
              ],
            },
          },
        ],
      }),
    )
    response.write(frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }))
    response.write(DONE)
    response.end()
    return
  }

  response.write(frame({ choices: [{ index: 0, delta: { role: "assistant", content: CLOSING } }] }))
  response.write(frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }))
  response.write(DONE)
  response.end()
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function parseArgs(argv: readonly string[]): FakeProviderOptions {
  const index = argv.indexOf("--port")
  return index === -1 ? {} : { port: Number(argv[index + 1]) }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const provider = await startFakeProvider(parseArgs(process.argv.slice(2)))
  console.log(`fake provider url: ${provider.url}`)
  console.log("Press Ctrl-C to stop.")
}
