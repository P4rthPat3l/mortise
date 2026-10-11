/** Why a {@link Live} value is not active. */
export type LiveInactiveReason = "restarting" | "disabled" | "failed" | "blocked"

/**
 * The liveness of a contract or a module, one value per state. `pending` means a provider exists but
 * has not supplied its value yet; `active` carries the value and the provider's activation
 * `generation`; `inactive` says why the value is unavailable.
 */
export type Live<T> =
  | { readonly status: "pending" }
  | { readonly status: "active"; readonly value: T; readonly generation: number }
  | { readonly status: "inactive"; readonly reason: LiveInactiveReason }
