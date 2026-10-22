// Builds the OpenCode client and binds the adapter's operations to it.

import type {
  DomainEvent,
  MessageId,
  PendingRequest,
  ServerId,
  SessionId,
  SessionSummary,
  TimelineItem,
} from "@mortise/domain"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { createEventTranslator, type EventDiagnostics } from "./events.js"
import { newMessageId } from "./ids.js"
import {
  answerForm,
  answerPermission,
  cancelForm,
  listPendingRequests,
  type PendingRequestOptions,
  type PermissionDecision,
} from "./requests.js"
import {
  activeSessions,
  type CreateSessionInput,
  createSession,
  getSession,
  interruptSession,
  listSessions,
  type PromptInput,
  promptSession,
} from "./sessions.js"
import { mapTimeline } from "./timeline.js"

/** How to reach one engine. The fetch is the gateway transport; the adapter never adds credentials itself. */
export interface AdapterOptions {
  readonly serverId: ServerId
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

/** Which page of messages to read. */
export interface TimelineOptions {
  readonly limit?: number
  readonly order?: "asc" | "desc"
  readonly cursor?: string
}

/** The engine adapter: domain-typed operations over one injected transport. */
export interface EngineAdapter {
  readonly serverId: ServerId
  readonly client: OpenCodeClient
  listSessions(): Promise<SessionSummary[]>
  /** Ids of sessions that are running, from the engine's active-session snapshot. */
  activeSessions(): Promise<SessionId[]>
  getSession(id: SessionId): Promise<SessionSummary>
  createSession(input?: CreateSessionInput): Promise<SessionSummary>
  prompt(input: PromptInput): Promise<void>
  interrupt(id: SessionId): Promise<boolean>
  timeline(id: SessionId, options?: TimelineOptions): Promise<TimelineItem[]>
  pendingRequests(options?: PendingRequestOptions): Promise<PendingRequest[]>
  answerPermission(input: {
    readonly sessionId: SessionId
    readonly requestId: PendingRequest["id"]
    readonly decision: PermissionDecision
    readonly message?: string
  }): Promise<void>
  answerForm(input: {
    readonly sessionId: SessionId
    readonly formId: PendingRequest["id"]
    readonly answer: Readonly<Record<string, string | number | boolean | readonly string[]>>
  }): Promise<void>
  cancelForm(input: {
    readonly sessionId: SessionId
    readonly formId: PendingRequest["id"]
    readonly message?: string
  }): Promise<void>
  /** Translates one raw wire event. See `events.ts`. */
  translate(wire: unknown): DomainEvent[]
  diagnostics(): EventDiagnostics
  newMessageId(now?: number): MessageId
}

/** Creates an adapter over one engine. */
export function createAdapter(options: AdapterOptions): EngineAdapter {
  const client = OpenCode.make({ baseUrl: options.baseUrl, fetch: options.fetch })
  const translator = createEventTranslator()
  return {
    serverId: options.serverId,
    client,
    listSessions: () => listSessions(client),
    activeSessions: () => activeSessions(client),
    getSession: (id) => getSession(client, id),
    createSession: (input) => createSession(client, input),
    prompt: (input) => promptSession(client, input),
    interrupt: (id) => interruptSession(client, id),
    timeline: async (id, timelineOptions = {}) =>
      mapTimeline(
        await client.message.list({
          sessionID: id,
          limit: timelineOptions.limit,
          order: timelineOptions.order,
          cursor: timelineOptions.cursor,
        }),
      ),
    pendingRequests: (pendingOptions) => listPendingRequests(client, pendingOptions),
    answerPermission: (input) => answerPermission(client, input),
    answerForm: (input) => answerForm(client, input),
    cancelForm: (input) => cancelForm(client, input),
    translate: translator.translate,
    diagnostics: translator.diagnostics,
    newMessageId,
  }
}
