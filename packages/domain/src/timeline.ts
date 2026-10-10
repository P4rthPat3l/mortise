import type { MessageId, PartId } from "./ids.js"

/** Lifecycle of a tool call as the UI renders it. */
export type ToolState = "pending" | "running" | "success" | "failed"

/** Visible prose from the model or the user. Corresponds to a text part of `SessionMessage`. */
export interface TextPart {
  readonly kind: "text"
  readonly id: PartId
  readonly text: string
}

/** Model reasoning shown in a collapsible block. Corresponds to a reasoning part. */
export interface ReasoningPart {
  readonly kind: "reasoning"
  readonly id: PartId
  readonly text: string
}

/** A tool invocation and its outcome. Corresponds to a tool part; input and output stay opaque here. */
export interface ToolCallPart {
  readonly kind: "tool"
  readonly id: PartId
  readonly callId: string
  readonly tool: string
  readonly state: ToolState
  /** Renderers for known tools narrow this; the model layer does not interpret it. */
  readonly input: unknown
  readonly output: unknown
}

/** A shell command run on the user's behalf. Corresponds to a shell message part. */
export interface ShellPart {
  readonly kind: "shell"
  readonly id: PartId
  readonly command: string
  readonly output: string
}

/** Marks where the engine summarized earlier history. Corresponds to a compaction part. */
export interface CompactionPart {
  readonly kind: "compaction"
  readonly id: PartId
}

/** A failure surfaced inside the conversation. Corresponds to an error attached to an assistant message. */
export interface ErrorPart {
  readonly kind: "error"
  readonly id: PartId
  readonly message: string
}

/** One renderable piece of a timeline item. Discriminated by `kind`. */
export type TimelinePart = TextPart | ReasoningPart | ToolCallPart | ShellPart | CompactionPart | ErrorPart

/** A message the user sent. Corresponds to a user `SessionMessage`. */
export interface UserMessageItem {
  readonly kind: "user"
  readonly id: MessageId
  /** Epoch milliseconds. */
  readonly createdAt: number
  readonly parts: readonly TimelinePart[]
}

/** A reply from the model. Corresponds to an assistant `SessionMessage`. */
export interface AssistantMessageItem {
  readonly kind: "assistant"
  readonly id: MessageId
  /** Epoch milliseconds. */
  readonly createdAt: number
  readonly parts: readonly TimelinePart[]
}

/** One entry in a session's conversation view. Discriminated by `kind`. */
export type TimelineItem = UserMessageItem | AssistantMessageItem

/**
 * An incremental change to a session's timeline, so streaming text does not resend whole
 * messages. Corresponds to the folded form of OpenCode session events.
 */
export type TimelinePatch =
  | { readonly type: "item.added"; readonly item: TimelineItem }
  | { readonly type: "part.added"; readonly messageId: MessageId; readonly part: TimelinePart }
  | {
      readonly type: "part.text.appended"
      readonly messageId: MessageId
      readonly partId: PartId
      readonly delta: string
    }
  | { readonly type: "part.updated"; readonly messageId: MessageId; readonly part: TimelinePart }
  | { readonly type: "item.removed"; readonly messageId: MessageId }

/** True once a tool call can no longer change state. */
export const isTerminalToolState = (state: ToolState): boolean => state === "success" || state === "failed"
