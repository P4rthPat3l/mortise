// T-015 spike: the versioned postMessage envelope. Exactly three calls exist, all extension-to-host:
// `commands.register`, `notify` and `network.fetch`. `network.fetch` is always denied because the
// sample extension requests no `network` capability. Host-to-extension messages are responses only.

export const EXTENSION_RPC_PROTOCOL = "mortise-extension-rpc"
export const EXTENSION_RPC_VERSION = 1

export type ExtensionCallName = "commands.register" | "notify" | "network.fetch"

export const EXTENSION_CALLS: readonly ExtensionCallName[] = ["commands.register", "notify", "network.fetch"]

export interface ExtensionRequest {
  readonly protocol: typeof EXTENSION_RPC_PROTOCOL
  readonly version: typeof EXTENSION_RPC_VERSION
  readonly direction: "extension-to-host"
  readonly id: string
  readonly kind: "request"
  readonly call: ExtensionCallName
  readonly params: Record<string, unknown>
}

export interface ExtensionResponse {
  readonly protocol: typeof EXTENSION_RPC_PROTOCOL
  readonly version: typeof EXTENSION_RPC_VERSION
  readonly direction: "host-to-extension"
  readonly id: string
  readonly kind: "response"
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCallName(value: unknown): value is ExtensionCallName {
  return typeof value === "string" && (EXTENSION_CALLS as readonly string[]).includes(value)
}

/**
 * Validates one message received from an extension frame. It accepts only an extension-to-host
 * request with the current protocol version and a known call; anything else is rejected. The source
 * frame is checked separately by the bridge, because it is the one thing a page cannot forge.
 */
export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!isRecord(value)) return false
  if (value.protocol !== EXTENSION_RPC_PROTOCOL) return false
  if (value.version !== EXTENSION_RPC_VERSION) return false
  if (value.direction !== "extension-to-host") return false
  if (value.kind !== "request") return false
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return false
  if (!isCallName(value.call)) return false
  if (!isRecord(value.params)) return false
  return true
}
