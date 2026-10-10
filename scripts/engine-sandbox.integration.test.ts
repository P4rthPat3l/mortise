// Integration coverage for the engine sandbox. Skipped unless MORTISE_INTEGRATION=1,
// because it starts a real engine process.
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveInstalledBinary, type Sandbox, startSandbox } from "./engine-sandbox"

const SERVICE_JSON = join(homedir(), ".local", "state", "opencode", "service.json")

function sandboxBinary(): "installed" | "bunx" {
  return resolveInstalledBinary() === undefined ? "bunx" : "installed"
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

async function readIfExists(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function info(sandbox: Sandbox): Promise<{ version: string; pid: number }> {
  const response = await fetch(`${sandbox.url}/api/info`, { headers: { authorization: basicAuth(sandbox.password) } })
  expect(response.status).toBe(200)
  return (await response.json()) as { version: string; pid: number }
}

describe.skipIf(!process.env.MORTISE_INTEGRATION)("engine sandbox", () => {
  it("AC-1: starts an isolated engine, serves /api/info, and leaves no process behind", async () => {
    const sandbox = await startSandbox({ binary: sandboxBinary() })
    try {
      const payload = await info(sandbox)
      expect(payload.version).toMatch(/^2\./)
      expect(payload.pid).toBe(sandbox.pid)
    } finally {
      await sandbox.stop()
    }
    expect(isAlive(sandbox.pid)).toBe(false)
  })

  it("AC-2: leaves the user's service.json byte-identical", async () => {
    const before = await readIfExists(SERVICE_JSON)
    const sandbox = await startSandbox({ binary: sandboxBinary() })
    try {
      await info(sandbox)
    } finally {
      await sandbox.stop()
    }
    const after = await readIfExists(SERVICE_JSON)
    expect(after).toEqual(before)
  })
})
