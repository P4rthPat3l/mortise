/**
 * A client-side identifier for one configured engine connection. Not an OpenCode concept:
 * the engine does not know how many servers the client talks to.
 */
export type ServerId = string & { readonly brand: "ServerId" }

/** Identifies a session in the UI. Corresponds to OpenCode's `Session.ID` (`ses_…`). */
export type SessionId = string & { readonly brand: "SessionId" }

/** Identifies a timeline item (one message). Corresponds to OpenCode's `SessionMessage.ID`. */
export type MessageId = string & { readonly brand: "MessageId" }

/** Identifies one part inside a timeline item. Corresponds to OpenCode's message part ids. */
export type PartId = string & { readonly brand: "PartId" }

/**
 * Identifies a pending permission or form request. Corresponds to OpenCode's `Permission` and
 * `Form.ID` (`frm_…`) identifiers.
 */
export type RequestId = string & { readonly brand: "RequestId" }

/** Identifies a project, so per-project state follows the project rather than a path. Corresponds to `Location.project`. */
export type ProjectId = string & { readonly brand: "ProjectId" }

/** Brands a string as a {@link ServerId}. Does not validate. */
export const serverId = (value: string): ServerId => value as ServerId

/** Brands a string as a {@link SessionId}. Does not validate. */
export const sessionId = (value: string): SessionId => value as SessionId

/** Brands a string as a {@link MessageId}. Does not validate. */
export const messageId = (value: string): MessageId => value as MessageId

/** Brands a string as a {@link PartId}. Does not validate. */
export const partId = (value: string): PartId => value as PartId

/** Brands a string as a {@link RequestId}. Does not validate. */
export const requestId = (value: string): RequestId => value as RequestId

/** Brands a string as a {@link ProjectId}. Does not validate. */
export const projectId = (value: string): ProjectId => value as ProjectId
