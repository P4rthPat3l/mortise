// Session reads and writes, mapped to the domain model.

import { type MessageId, projectId, type SessionId, type SessionSummary, sessionId } from "@mortise/domain"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"

/** What the user asks for when creating a session. The engine owns the rest. */
export interface CreateSessionInput {
  readonly directory?: string
  readonly title?: string
  readonly parentId?: SessionId
}

/** One prompt to send. `clientMessageId` makes a retry idempotent: the engine returns the first admission. */
export interface PromptInput {
  readonly sessionId: SessionId
  readonly text: string
  readonly clientMessageId: MessageId
}

/**
 * Reduces a wire session to a list row. Activity is not part of `Session.Info`; execution events and
 * the `/api/session/active` snapshot decide it, so the adapter reports `idle` here.
 */
export function toSessionSummary(info: SessionInfo): SessionSummary {
  return {
    id: sessionId(info.id),
    title: info.title ?? "",
    projectId: projectId(info.projectID),
    directory: info.location.directory,
    createdAt: info.time.created,
    updatedAt: info.time.updated,
    activity: "idle",
    parentId: info.parentID === undefined ? undefined : sessionId(info.parentID),
  }
}

/** Lists sessions, newest first, as the engine returns them. */
export async function listSessions(client: OpenCodeClient): Promise<SessionSummary[]> {
  const response = await client.session.list()
  return response.data.map(toSessionSummary)
}

/** Ids of the sessions the engine reports as running right now. */
export async function activeSessions(client: OpenCodeClient): Promise<SessionId[]> {
  const active = await client.session.active()
  return Object.entries(active)
    .filter(([, state]) => state.type === "running")
    .map(([id]) => sessionId(id))
}

/** Reads one session. */
export async function getSession(client: OpenCodeClient, id: SessionId): Promise<SessionSummary> {
  return toSessionSummary(await client.session.get({ sessionID: id }))
}

/** Creates a session, optionally in a directory and with a title. */
export async function createSession(client: OpenCodeClient, input: CreateSessionInput = {}): Promise<SessionSummary> {
  const info = await client.session.create({
    location: input.directory === undefined ? undefined : { directory: input.directory },
    title: input.title,
    parentID: input.parentId,
  })
  return toSessionSummary(info)
}

/**
 * Sends a prompt. Always sends `id: clientMessageId` so the engine treats a retry as the same
 * admission; sends only the fields the connected engine declares.
 */
export async function promptSession(client: OpenCodeClient, input: PromptInput): Promise<void> {
  await client.session.prompt({
    sessionID: input.sessionId,
    id: input.clientMessageId,
    text: input.text,
  })
}

/** Interrupts the active run of a session. Returns whether one was interrupted. */
export async function interruptSession(client: OpenCodeClient, id: SessionId): Promise<boolean> {
  const response = await client.session.interrupt({ sessionID: id })
  return response.interrupted
}
