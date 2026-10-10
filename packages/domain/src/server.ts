import type { ServerId } from "./ids.js"

/**
 * A server the user can connect to, as the UI lists it. Corresponds to an OpenCode service
 * registration, but carries no credentials: those never leave the gateway.
 */
export interface ServerRef {
  readonly id: ServerId
  /** Name shown in the server picker. */
  readonly label: string
  /** `shared` is the user's own running service, `isolated` one Mortise started, `remote` a paired machine. */
  readonly kind: "shared" | "isolated" | "remote"
  readonly url: string
}
