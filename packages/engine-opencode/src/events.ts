// Translates one OpenCode wire event into zero or more domain events.

import {
  type DomainEvent,
  messageId,
  projectId,
  requestId,
  type SessionId,
  sessionId,
  type TimelinePatch,
} from "@mortise/domain"
import { decodeFormRequest, decodePermissionRequest } from "./requests.js"
import { errorPartId, reasoningPartId, textPartId, toolPartId } from "./timeline.js"

/** Counts wire events one adapter could not use, for diagnostics. Neither count ever throws. */
export interface EventDiagnostics {
  /** Events with a `type` the adapter does not know (including future engine events). */
  readonly unknownTypes: number
  /** Events with a known type whose payload did not match its declared shape. */
  readonly malformedPayloads: number
}

/** Translation and counters owned by one adapter, so two servers never share a count. */
export interface EventTranslator {
  /** Translates one raw wire event. See {@link createEventTranslator}. */
  translate(wire: unknown): DomainEvent[]
  /** Reads this translator's counters without resetting them. */
  diagnostics(): EventDiagnostics
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const patch = (target: SessionId, timeline: TimelinePatch): DomainEvent => ({
  type: "timeline.patch",
  sessionId: target,
  patch: timeline,
})

const readSessionId = (data: Record<string, unknown>): SessionId | undefined => {
  const value = asString(data.sessionID)
  return value === undefined ? undefined : sessionId(value)
}

const errorMessage = (value: unknown): string => {
  if (isRecord(value)) {
    const message = asString(value.message)
    if (message !== undefined) return message
    const type = asString(value.type)
    if (type !== undefined) return type
  }
  return "The tool call failed."
}

const parseInput = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Known event families the adapter recognizes but does not turn into domain events (catalog
 * refreshes, usage records, PTYs, TUI frames, plugin RPC). They are not counted as unknown.
 */
const KNOWN_UNMAPPED: ReadonlySet<string> = new Set([
  "server.connected",
  "session.idle",
  "session.status",
  "session.renamed",
  "session.deleted",
  "session.moved",
  "session.viewed",
  "session.metadata.updated",
  "session.agent.selected",
  "session.model.selected",
  "session.permissions",
  "session.forked",
  "session.instructions.updated",
  "session.usage.updated",
  "session.inbox.cancelled",
  "session.inbox.delivery.changed",
  "session.step.streamed",
  "session.step.ended",
  "session.tool.input.delta",
  "session.compaction.started",
  "session.compaction.delta",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
  "session.synthetic",
  "session.skill.activated",
  "session.shell.started",
  "session.shell.ended",
  "session.message.content.updated",
  "project.updated",
  "integration.updated",
  "provider.updated",
  "model.updated",
  "agent.updated",
  "command.updated",
  "skill.updated",
  "websearch.updated",
  "reference.updated",
  "plugin.updated",
  "config.updated",
  "credential.updated",
  "credential.switched",
  "installation.updated",
  "installation.update-available",
  "models-dev.refreshed",
  "vcs.branch.updated",
  "filesystem.changed",
  "worktree.updated",
  "worktree.resolved",
  "mcp.status.changed",
  "mcp.resources.changed",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "persistent-pty.added",
  "persistent-pty.removed",
  "shell.created",
  "shell.exited",
  "shell.deleted",
  "location.shutdown",
  "tui.prompt.append",
  "tui.command.execute",
  "tui.session.select",
  "tui.toast.show",
])

/**
 * Creates a translator with its own diagnostics counters. One adapter owns one translator, so
 * counts never mix across servers and tests start at zero by creating a fresh adapter.
 *
 * Translating one wire event returns the domain events it produces: an unknown type or a malformed
 * payload yields `[]` and bumps a counter, never an exception, because the stream is untrusted.
 */
export function createEventTranslator(): EventTranslator {
  const counters = { unknownTypes: 0, malformedPayloads: 0 }
  const malformed = (): DomainEvent[] => {
    counters.malformedPayloads += 1
    return []
  }

  const translate = (wire: unknown): DomainEvent[] => {
    if (!isRecord(wire)) return malformed()
    const type = asString(wire.type)
    if (type === undefined) return malformed()
    const data = wire.data

    switch (type) {
      case "session.created": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const project = asString(data.projectID)
        const location = isRecord(data.location) ? asString(data.location.directory) : undefined
        const created = asNumber(wire.created)
        if (id === undefined || project === undefined || location === undefined || created === undefined) {
          return malformed()
        }
        const parent = asString(data.parentID)
        return [
          {
            type: "session.changed",
            session: {
              id,
              title: asString(data.title) ?? "",
              projectId: projectId(project),
              directory: location,
              createdAt: created,
              updatedAt: created,
              activity: "idle",
              parentId: parent === undefined ? undefined : sessionId(parent),
            },
          },
        ]
      }

      case "session.execution.started": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        if (id === undefined) return malformed()
        return [{ type: "session.activity", sessionId: id, status: "running" }]
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        if (id === undefined) return malformed()
        return [{ type: "session.activity", sessionId: id, status: "idle" }]
      }
      case "session.retry.scheduled": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        if (id === undefined) return malformed()
        return [{ type: "session.activity", sessionId: id, status: "retrying" }]
      }

      case "session.inbox.enqueued": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const inboxItem = isRecord(data.item) ? data.item : undefined
        const inboxID = asString(data.inboxID)
        const created = asNumber(wire.created)
        if (id === undefined || inboxItem === undefined || inboxID === undefined || created === undefined) {
          return malformed()
        }
        if (inboxItem.type !== "user") return []
        const payload = isRecord(inboxItem.payload) ? inboxItem.payload : undefined
        const text = payload === undefined ? undefined : asString(payload.text)
        if (text === undefined) return malformed()
        const itemId = messageId(inboxID)
        return [
          patch(id, {
            type: "item.added",
            item: {
              kind: "user",
              id: itemId,
              createdAt: created,
              parts: [{ kind: "text", id: textPartId(inboxID, 0), text }],
            },
          }),
        ]
      }
      case "session.inbox.delivered": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const inboxID = asString(data.inboxID)
        const created = asNumber(wire.created)
        if (id === undefined || inboxID === undefined || created === undefined) return malformed()
        return [patch(id, { type: "item.patched", messageId: messageId(inboxID), createdAt: created })]
      }

      case "session.step.started": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const started = asNumber(data.started)
        if (id === undefined || assistant === undefined || started === undefined) return malformed()
        return [
          patch(id, {
            type: "item.added",
            item: { kind: "assistant", id: messageId(assistant), createdAt: started, parts: [] },
          }),
        ]
      }
      case "session.step.failed": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        if (id === undefined || assistant === undefined) return malformed()
        return [
          patch(id, {
            type: "part.added",
            messageId: messageId(assistant),
            part: { kind: "error", id: errorPartId(assistant), message: errorMessage(data.error) },
          }),
        ]
      }

      case "session.text.started":
      case "session.reasoning.started": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const ordinal = asNumber(data.ordinal)
        if (id === undefined || assistant === undefined || ordinal === undefined) return malformed()
        const kind = type === "session.text.started" ? "text" : "reasoning"
        const partId = kind === "text" ? textPartId(assistant, ordinal) : reasoningPartId(assistant, ordinal)
        return [
          patch(id, {
            type: "part.added",
            messageId: messageId(assistant),
            part: { kind, id: partId, text: "" },
          }),
        ]
      }
      case "session.text.delta":
      case "session.reasoning.delta": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const ordinal = asNumber(data.ordinal)
        const delta = asString(data.delta)
        if (id === undefined || assistant === undefined || ordinal === undefined || delta === undefined) {
          return malformed()
        }
        const partId =
          type === "session.text.delta" ? textPartId(assistant, ordinal) : reasoningPartId(assistant, ordinal)
        return [patch(id, { type: "part.text.appended", messageId: messageId(assistant), partId, delta })]
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const ordinal = asNumber(data.ordinal)
        const text = asString(data.text)
        if (id === undefined || assistant === undefined || ordinal === undefined || text === undefined) {
          return malformed()
        }
        const kind = type === "session.text.ended" ? "text" : "reasoning"
        const partId = kind === "text" ? textPartId(assistant, ordinal) : reasoningPartId(assistant, ordinal)
        return [
          patch(id, {
            type: "part.updated",
            messageId: messageId(assistant),
            part: { kind, id: partId, text },
          }),
        ]
      }

      case "session.tool.input.started": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        const name = asString(data.name)
        if (id === undefined || assistant === undefined || call === undefined || name === undefined) {
          return malformed()
        }
        return [
          patch(id, {
            type: "part.added",
            messageId: messageId(assistant),
            part: {
              kind: "tool",
              id: toolPartId(call),
              callId: call,
              tool: name,
              state: "pending",
              input: undefined,
              output: undefined,
            },
          }),
        ]
      }
      case "session.tool.input.ended": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        const text = asString(data.text)
        if (id === undefined || assistant === undefined || call === undefined || text === undefined) {
          return malformed()
        }
        return [
          patch(id, {
            type: "part.patched",
            messageId: messageId(assistant),
            partId: toolPartId(call),
            patch: { input: parseInput(text) },
          }),
        ]
      }
      case "session.tool.called": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        if (id === undefined || assistant === undefined || call === undefined) return malformed()
        return [
          patch(id, {
            type: "part.patched",
            messageId: messageId(assistant),
            partId: toolPartId(call),
            patch: { state: "running", input: data.input },
          }),
        ]
      }
      case "session.tool.progress": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        if (id === undefined || assistant === undefined || call === undefined) return malformed()
        return [
          patch(id, {
            type: "part.patched",
            messageId: messageId(assistant),
            partId: toolPartId(call),
            patch: { metadata: data.metadata },
          }),
        ]
      }
      case "session.tool.success": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        if (id === undefined || assistant === undefined || call === undefined) return malformed()
        return [
          patch(id, {
            type: "part.patched",
            messageId: messageId(assistant),
            partId: toolPartId(call),
            patch: { state: "success", output: data.content, metadata: data.metadata },
          }),
        ]
      }
      case "session.tool.failed": {
        if (!isRecord(data)) return malformed()
        const id = readSessionId(data)
        const assistant = asString(data.assistantMessageID)
        const call = asString(data.id)
        if (id === undefined || assistant === undefined || call === undefined) return malformed()
        return [
          patch(id, {
            type: "part.patched",
            messageId: messageId(assistant),
            partId: toolPartId(call),
            patch: {
              state: "failed",
              output: data.content,
              metadata: data.metadata,
              error: errorMessage(data.error),
            },
          }),
        ]
      }

      case "permission.asked": {
        if (!isRecord(data)) return malformed()
        const created = asNumber(wire.created)
        const request = created === undefined ? undefined : decodePermissionRequest(data, created)
        if (request === undefined) return malformed()
        return [{ type: "request.opened", request }]
      }
      case "permission.replied": {
        if (!isRecord(data)) return malformed()
        const requestID = asString(data.requestID)
        if (requestID === undefined) return malformed()
        return [{ type: "request.closed", requestId: requestId(requestID) }]
      }
      case "form.created": {
        if (!isRecord(data)) return malformed()
        const created = asNumber(wire.created)
        const request = created === undefined ? undefined : decodeFormRequest(data.form, created)
        if (request === undefined) return malformed()
        return [{ type: "request.opened", request }]
      }
      case "form.replied":
      case "form.cancelled": {
        if (!isRecord(data)) return malformed()
        const formID = asString(data.id)
        if (formID === undefined) return malformed()
        return [{ type: "request.closed", requestId: requestId(formID) }]
      }

      default: {
        if (type.startsWith("rpc.") || KNOWN_UNMAPPED.has(type)) return []
        counters.unknownTypes += 1
        return []
      }
    }
  }

  return { translate, diagnostics: () => ({ ...counters }) }
}
