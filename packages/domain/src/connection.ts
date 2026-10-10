import type { EngineInfo } from "./engine.js"

/**
 * Where the client is in its life with one engine; drives every connection banner and disabled
 * state. Mirrors the engine connection state diagram in the architecture overview (6.6).
 * Discriminated by `phase`.
 */
export type ConnectionState =
  /** Looking for a running engine registration. */
  | { readonly phase: "discovering" }
  /** No engine found and policy allows starting one; waiting for it to become ready. */
  | { readonly phase: "starting" }
  /** No engine found and starting is not allowed. */
  | { readonly phase: "no-engine" }
  /** Engine found; opening the connection and event stream. */
  | { readonly phase: "connecting"; readonly url: string }
  /** The engine answered 401: credentials are missing or stale. */
  | { readonly phase: "unauthorized"; readonly url: string }
  /** The engine is reachable but outside the supported range or missing a required capability. */
  | {
      readonly phase: "incompatible"
      readonly reason: "info-missing" | "version-out-of-range" | "missing-capability"
      /** Version the engine reported, when it reported one. */
      readonly engineVersion?: string
      /** Human-readable supported range, for example `>=2.0.20 <2.1.0`. */
      readonly supportedRange: string
    }
  /** Event stream is open; loading snapshots of visible state. */
  | { readonly phase: "hydrating"; readonly info: EngineInfo }
  /** Fully connected; views are current. */
  | { readonly phase: "live"; readonly info: EngineInfo }
  /** The stream ended, stalled or overflowed; views are stale until rehydrated. */
  | {
      readonly phase: "resyncing"
      readonly info: EngineInfo
      readonly reason: "ended" | "stalled" | "overflow"
    }
  /** Starting or connecting failed in a way that needs a retry. */
  | { readonly phase: "failed"; readonly message: string }

/** Every `phase` value of {@link ConnectionState}. */
export type ConnectionPhase = ConnectionState["phase"]
