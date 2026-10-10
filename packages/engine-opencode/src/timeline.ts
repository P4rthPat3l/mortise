// Maps a page of OpenCode session messages to the domain timeline.

import {
  messageId,
  type PartId,
  partId,
  type TimelineItem,
  type TimelinePart,
  type ToolCallPart,
  type ToolState,
} from "@mortise/domain"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionMessageUser,
} from "@opencode/client"

/**
 * Part id for one text or reasoning segment. The wire addresses these by `(messageID, ordinal)`
 * rather than giving each a stable id, so the adapter derives one.
 */
export const textPartId = (id: string, ordinal: number): PartId => partId(`${id}:text:${ordinal}`)

/** See {@link textPartId}. */
export const reasoningPartId = (id: string, ordinal: number): PartId => partId(`${id}:reasoning:${ordinal}`)

/** Part id for a tool call, keyed by the wire call id. */
export const toolPartId = (callId: string): PartId => partId(callId)

/** Part id for the error attached to an assistant message. */
export const errorPartId = (id: string): PartId => partId(`${id}:error`)

const toToolState = (status: SessionMessageAssistantTool["state"]["status"]): ToolState => {
  switch (status) {
    case "streaming":
      return "pending"
    case "running":
      return "running"
    case "completed":
      return "success"
    case "error":
      return "failed"
  }
}

const toToolPart = (part: SessionMessageAssistantTool): ToolCallPart => {
  const state = part.state
  return {
    kind: "tool",
    id: toolPartId(part.id),
    callId: part.id,
    tool: part.name,
    state: toToolState(state.status),
    input: state.input,
    output: state.status === "completed" || state.status === "error" ? state.content : undefined,
    metadata: state.status === "completed" || state.status === "error" ? state.metadata : undefined,
    error: state.status === "error" ? state.error.message : undefined,
  }
}

const toAssistantParts = (message: SessionMessageAssistant): TimelinePart[] => {
  const parts: TimelinePart[] = []
  message.content.forEach((part, ordinal) => {
    switch (part.type) {
      case "text":
        parts.push({ kind: "text", id: textPartId(message.id, ordinal), text: part.text })
        break
      case "reasoning":
        parts.push({ kind: "reasoning", id: reasoningPartId(message.id, ordinal), text: part.text })
        break
      case "tool":
        parts.push(toToolPart(part))
        break
    }
  })
  if (message.error !== undefined) {
    parts.push({ kind: "error", id: errorPartId(message.id), message: message.error.message })
  }
  return parts
}

const toAssistantItem = (message: SessionMessageAssistant): TimelineItem => ({
  kind: "assistant",
  id: messageId(message.id),
  createdAt: message.time.created,
  parts: toAssistantParts(message),
})

const toUserItem = (message: SessionMessageUser): TimelineItem => ({
  kind: "user",
  id: messageId(message.id),
  createdAt: message.time.created,
  parts: [{ kind: "text", id: textPartId(message.id, 0), text: message.text }],
})

const toItem = (message: SessionMessageInfo): TimelineItem | undefined => {
  switch (message.type) {
    case "user":
      return toUserItem(message)
    case "assistant":
      return toAssistantItem(message)
    default:
      // Shell, compaction, synthetic, skill, system and switch markers are not timeline items in v0.
      return undefined
  }
}

/**
 * Maps one page of session messages to a chronological timeline. The engine returns the newest
 * message first; the adapter sorts by creation time so a page folds in the same order as events.
 */
export function mapTimeline(response: SessionMessagesResponse): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const message of response.data) {
    const item = toItem(message)
    if (item !== undefined) items.push(item)
  }
  return items.sort((left, right) => left.createdAt - right.createdAt)
}
