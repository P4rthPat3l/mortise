import type { RequestId, SessionId } from "./ids.js"

/** Fields shared by everything that blocks a session until the user answers. */
interface PendingRequestBase {
  readonly id: RequestId
  readonly sessionId: SessionId
  /** One-line summary for the inbox and prompt dock. */
  readonly title: string
  readonly detail?: string
  /** Epoch milliseconds. */
  readonly createdAt: number
}

/** The agent asks to do something that needs approval. Corresponds to an OpenCode permission request. */
export interface PermissionRequest extends PendingRequestBase {
  readonly kind: "permission"
}

/** A choice offered by a form field. Corresponds to `Form.Option`. */
export interface FormOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}

/**
 * One question in a form. Corresponds to the string, number, integer, boolean, select, multiselect
 * and external fields of `Form`.
 */
export interface FormQuestion {
  readonly key: string
  readonly type: "string" | "number" | "integer" | "boolean" | "multiselect" | "external"
  readonly title?: string
  readonly description?: string
  readonly required?: boolean
  readonly placeholder?: string
  readonly options?: readonly FormOption[]
  /** Where an `external` question sends the user to connect or configure something. */
  readonly url?: string
}

/** The agent asks the user to fill in a form. Corresponds to an OpenCode `Form` request. */
export interface FormRequest extends PendingRequestBase {
  readonly kind: "form"
  readonly questions: readonly FormQuestion[]
}

/** Anything waiting on the user. Discriminated by `kind`. */
export type PendingRequest = PermissionRequest | FormRequest
