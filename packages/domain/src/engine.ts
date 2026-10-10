/**
 * Optional engine features the UI can gate on. Corresponds to `ServerInfo` and the set of
 * routes the connected OpenCode version exposes.
 */
export interface EngineCapabilities {
  /** The engine can pair a remote client (`server.pair`). */
  readonly pairing: boolean
  /** Terminals survive client disconnects (`ServerInfo.capabilities.persistentPty`). */
  readonly persistentTerminals: boolean
  /** A session can be forked before a given message. */
  readonly forkBeforeMessage: boolean
  /** Operation ids available under `/api/experimental`. */
  readonly experimental: ReadonlySet<string>
}

/**
 * How well Mortise knows the connected engine version. Derived from the supported range
 * (`>=2.0.20 <2.1.0`): inside it is `supported`, newer but untried is `untested`.
 */
export type SupportState = "supported" | "untested" | "unsupported"

/** What the UI knows about the connected engine. Corresponds to OpenCode's `/api/info` response. */
export interface EngineInfo {
  readonly version: string
  readonly capabilities: EngineCapabilities
  readonly support: SupportState
}
