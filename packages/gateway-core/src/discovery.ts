// Discovery of the shared OpenCode service (FEAT-001 §BR-001..BR-004). The upstream
// `discover()`/`ensure()` functions are wrapped behind an injectable interface so the connection
// machine and its tests never touch the filesystem, the CLI or a real engine.

import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { discover as opencodeDiscover, ensure as opencodeEnsure } from "@opencode/client/service"

/** Connection details of a discovered service. Carries the password; it never leaves the gateway. */
export interface ServiceEndpoint {
  readonly url: string
  readonly auth?: {
    readonly type: "basic"
    readonly username: string
    readonly password: string
  }
}

/** Options the discovery wrapper forwards to `discover()`/`ensure()`. */
export interface ServiceOptions {
  readonly file?: string
  readonly version?: string | ((version: string) => boolean)
  readonly command?: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
}

/**
 * The two operations discovery needs from `@opencode/client/service`. Injected so unit tests stay
 * offline and the real client is wrapped in exactly one place.
 */
export interface ServiceClient {
  discover(options?: ServiceOptions): Promise<ServiceEndpoint | undefined>
  ensure(options?: ServiceOptions): Promise<ServiceEndpoint>
}

/** The user's CLI command that starts the shared service (FEAT-001 §BR-002, §13.6). */
export const SERVICE_COMMAND = ["opencode", "serve", "--service"] as const

/** Why the gateway found no engine to join or start. */
export type NoEngineReason = "no-cli" | "start-disabled"

/** What the discovery policy decided. */
export type DiscoveryOutcome =
  | { readonly kind: "found"; readonly endpoint: ServiceEndpoint }
  | { readonly kind: "started"; readonly endpoint: ServiceEndpoint }
  | { readonly kind: "no-engine"; readonly reason: NoEngineReason }

/** Dependencies of {@link createDiscovery}. */
export interface DiscoveryDeps {
  /** The wrapped `discover()`/`ensure()`. */
  readonly client: ServiceClient
  /** Whether the user's `opencode` CLI can be found (ASM-003). */
  readonly findCli: () => Promise<boolean>
  /** Whether start policy may spawn the user's CLI (FEAT-001 §START_ALLOWED). Defaults to true. */
  readonly startAllowed?: boolean
}

/** Finds the shared service, or starts one when policy allows (FEAT-001 §8). */
export interface Discovery {
  /** Re-read the registration without starting anything; used after a `401` (FEAT-001 §AC-004). */
  discover(): Promise<ServiceEndpoint | undefined>
  /**
   * Adopt a ready registration, or start the shared service with the user's CLI. `onStarting` fires
   * just before `ensure()` so the caller can enter the `starting` state.
   */
  findOrStart(options?: { readonly onStarting?: () => void }): Promise<DiscoveryOutcome>
}

/**
 * The start policy: join a ready registration and never call `ensure()` while one exists
 * (§BR-001); start only when none is registered and the CLI is installed (§BR-004); never pass a
 * `version`, so the user's own CLI starts the service (§BR-002, §13.6).
 */
export function createDiscovery(deps: DiscoveryDeps): Discovery {
  const startAllowed = deps.startAllowed ?? true
  return {
    discover: () => deps.client.discover(),
    async findOrStart(options = {}) {
      const found = await deps.client.discover()
      if (found !== undefined) return { kind: "found", endpoint: found }
      if (!startAllowed) return { kind: "no-engine", reason: "start-disabled" }
      if (!(await deps.findCli())) return { kind: "no-engine", reason: "no-cli" }
      options.onStarting?.()
      const endpoint = await deps.client.ensure({ command: SERVICE_COMMAND })
      return { kind: "started", endpoint }
    },
  }
}

/**
 * The production {@link ServiceClient}: the Promise service module of `@opencode/client`. This is
 * the one place `discover()`/`ensure()` are referenced; everything else injects this.
 */
export function openCodeServiceClient(): ServiceClient {
  return {
    discover: (options) => opencodeDiscover(options),
    ensure: (options) => opencodeEnsure(options),
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Looks for the user's `opencode` CLI on `PATH` and in common install locations (FEAT-001 ASM-003,
 * §13.6). No bundled binary (DEC-0001 in §13.6). Injected as `findCli` in unit tests.
 */
export async function defaultFindCli(): Promise<boolean> {
  const names = process.platform === "win32" ? ["opencode.exe", "opencode.cmd", "opencode.bat"] : ["opencode"]
  const pathDirectories = (process.env["PATH"] ?? "").split(delimiter).filter((entry) => entry !== "")
  const directories = [
    ...pathDirectories,
    join(homedir(), ".opencode", "bin"),
    join(homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/usr/bin",
  ]
  for (const directory of directories) {
    for (const name of names) {
      if (await isExecutable(join(directory, name))) return true
    }
  }
  return false
}
