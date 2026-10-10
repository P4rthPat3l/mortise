// Starts a fully isolated OpenCode engine for tests and fixture recording.
//
// Isolation rules (AGENTS.md hard rules 1 and 2):
//   - `opencode serve` runs WITHOUT `--service`, so it never registers in the user's
//     `service.json` and cannot collide with the shared service.
//   - `OPENCODE_DB` and every `XDG_*` directory point at a fresh temp tree under
//     `.sandbox/` (gitignored), so no user provider, credential or history is visible.
//   - The child environment is scrubbed of inherited `OPENCODE_*` variables (this
//     machine exports `OPENCODE_CONFIG`, `OPENCODE_PASSWORD` and friends), and `HOME`
//     plus the working directory are redirected into the sandbox. Without that, config
//     discovery would walk up into `~/.opencode`, `~/.claude` and `~/.agents`.
import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { accessSync, constants, existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SANDBOX_ROOT = join(REPO_ROOT, ".sandbox")

/** Engine version pinned when the sandbox falls back to `bunx @opencode/cli@<version>`. */
export const DEFAULT_VERSION = "2.0.26"

/** Every engine this client supports prints its version as `opencode v2.x.y`. */
const VERSION_PREFIX = "opencode v2."

export type SandboxBinary = "bunx" | "installed"

export interface SandboxOptions {
  /** `"bunx"` (default) runs the pinned npm CLI; `"installed"` runs the local binary. */
  binary?: SandboxBinary
  /** npm version for the `"bunx"` binary. Defaults to {@link DEFAULT_VERSION}. */
  version?: string
  /** Loopback port. A free port is chosen when omitted. */
  port?: number
  /** Contents of the sandbox's `opencode.json`. Defaults to disabling self-update. */
  config?: Record<string, unknown>
}

export interface SandboxDirs {
  root: string
  state: string
  data: string
  config: string
  cache: string
  tmp: string
  home: string
  work: string
}

export interface Sandbox {
  url: string
  password: string
  pid: number
  dirs: SandboxDirs
  /** Kills the engine process tree. Safe to call more than once. */
  stop: () => Promise<void>
}

/**
 * The command that starts the engine, before the `serve` subcommand.
 * Returns the local binary path when present, else `opencode` on `PATH`.
 */
export function resolveInstalledBinary(): string | undefined {
  const local = join(homedir(), ".opencode", "bin", "opencode")
  if (existsSync(local)) return local
  return which("opencode")
}

/** Runs `<command> --version` and returns the version, or `undefined` when it is not a v2 engine. */
export async function readVersion(command: readonly string[]): Promise<string | undefined> {
  const result = await run(command, ["--version"])
  if (result.code !== 0) return undefined
  const line = result.stdout.trim()
  return line.startsWith(VERSION_PREFIX) ? line.slice("opencode v".length) : undefined
}

/**
 * Starts an isolated engine and resolves once `GET /api/info` answers 200.
 * Every sandbox is killed on `stop()` and again on process exit.
 */
export async function startSandbox(options: SandboxOptions = {}): Promise<Sandbox> {
  const binary = options.binary ?? "bunx"
  const version = options.version ?? DEFAULT_VERSION
  const command =
    binary === "installed" ? [resolveInstalledBinary() ?? "opencode"] : ["bunx", `@opencode/cli@${version}`]

  const reported = await readVersion(command)
  if (reported === undefined) {
    throw new Error(`Refusing to start the sandbox: ${command.join(" ")} --version did not report a v2 engine.`)
  }

  const port = options.port ?? (await findFreePort())
  const dirs = await createDirs()
  const password = randomBytes(24).toString("base64url")

  await mkdir(join(dirs.config, "opencode"), { recursive: true })
  await writeFile(
    join(dirs.config, "opencode", "opencode.json"),
    `${JSON.stringify(options.config ?? { update: "disable" }, null, 2)}\n`,
    "utf8",
  )

  const child = spawn(
    command[0] as string,
    [...command.slice(1), "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: dirs.work,
      env: sandboxEnv(dirs, password),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )

  let log = ""
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()))
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()))

  const url = `http://127.0.0.1:${port}`
  track(child)
  installExitHandlers()

  let exited: number | undefined
  child.once("exit", (code) => (exited = code ?? -1))

  try {
    await waitForReady(
      url,
      password,
      () => exited,
      () => log,
    )
  } catch (error) {
    untrack(child)
    await terminate(child)
    throw error
  }

  const stop = once(async () => {
    untrack(child)
    await terminate(child)
  })

  return { url, password, pid: child.pid ?? -1, dirs, stop }
}

async function createDirs(): Promise<SandboxDirs> {
  await mkdir(SANDBOX_ROOT, { recursive: true })
  const root = await mkdtemp(join(SANDBOX_ROOT, "sandbox-"))
  const dirs: SandboxDirs = {
    root,
    state: join(root, "state"),
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    tmp: join(root, "tmp"),
    home: join(root, "home"),
    work: join(root, "work"),
  }
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })))
  return dirs
}

function sandboxEnv(dirs: SandboxDirs, password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith("OPENCODE")) continue
    if (key === "HOME" || key === "TMPDIR") continue
    if (key.startsWith("XDG_") && key !== "XDG_CONFIG_DIRS") continue
    env[key] = value
  }
  env.HOME = dirs.home
  env.TMPDIR = dirs.tmp
  env.XDG_STATE_HOME = dirs.state
  env.XDG_DATA_HOME = dirs.data
  env.XDG_CONFIG_HOME = dirs.config
  env.XDG_CACHE_HOME = dirs.cache
  env.OPENCODE_PASSWORD = password
  env.OPENCODE_DB = join(dirs.root, "opencode.db")
  return env
}

async function waitForReady(
  url: string,
  password: string,
  exited: () => number | undefined,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000
  const authorization = basicAuth(password)
  while (Date.now() < deadline) {
    const code = exited()
    if (code !== undefined) throw new Error(`Engine exited before it was ready (code ${code}).\n${log()}`)
    try {
      const response = await fetch(`${url}/api/info`, {
        headers: { authorization },
        signal: AbortSignal.timeout(2_000),
      })
      if (response.status === 200) return
      if (response.status === 401) throw new Error("Engine rejected the sandbox password.")
    } catch (error) {
      if (error instanceof Error && error.message === "Engine rejected the sandbox password.") throw error
    }
    await sleep(200)
  }
  throw new Error(`Engine did not answer /api/info within 30s.\n${log()}`)
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

function which(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return undefined
}

function run(
  command: readonly string[],
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0] as string, [...command.slice(1), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    child.once("error", reject)
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

const tracked = new Set<ChildProcess>()
let handlersInstalled = false

function track(child: ChildProcess): void {
  tracked.add(child)
}

function untrack(child: ChildProcess): void {
  tracked.delete(child)
}

function installExitHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true
  const killAll = () => {
    for (const child of tracked) killGroup(child, "SIGKILL")
  }
  process.on("exit", killAll)
  process.on("SIGINT", () => {
    killAll()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    killAll()
    process.exit(143)
  })
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      process.kill(child.pid, signal)
    } catch {}
  }
}

function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => resolve()
    child.once("exit", finish)
    killGroup(child, "SIGTERM")
    const force = setTimeout(() => {
      killGroup(child, "SIGKILL")
      setTimeout(finish, 1_000)
    }, 4_000)
    child.once("exit", () => clearTimeout(force))
  })
}

function once<A>(fn: () => Promise<A>): () => Promise<A> {
  let result: Promise<A> | undefined
  return () => (result ??= fn())
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv: readonly string[]): { version?: string; port?: number; binary?: SandboxBinary } {
  const options: { version?: string; port?: number; binary?: SandboxBinary } = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--version") options.version = argv[++index]
    else if (arg === "--port") options.port = Number(argv[++index])
    else if (arg === "--binary") options.binary = argv[++index] as SandboxBinary
  }
  return options
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  const sandbox = await startSandbox(options)
  console.log(`sandbox url:      ${sandbox.url}`)
  console.log(`sandbox password: ${sandbox.password}`)
  console.log(`sandbox dir:      ${sandbox.dirs.root}`)
  console.log("Press Ctrl-C to stop.")
}
