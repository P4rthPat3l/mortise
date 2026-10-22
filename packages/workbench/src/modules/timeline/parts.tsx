import type { SessionId, TimelinePart } from "@mortise/domain"
import type { TimelineReader } from "./contract"
import { usePart } from "./use-part"

const show = (value: unknown): string => {
  if (value === undefined) return ""
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

/** Text that streams into one leaf: the only component a text delta re-renders. */
export function StreamingText({
  timeline,
  sessionId,
  partId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
}) {
  const part = usePart(timeline, sessionId, partId)
  if (part === undefined || (part.kind !== "text" && part.kind !== "reasoning")) return null
  return <span className={`timeline-part timeline-part-${part.kind}`}>{part.text}</span>
}

function ToolPart({
  timeline,
  sessionId,
  partId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
}) {
  const part = usePart(timeline, sessionId, partId)
  if (part === undefined || part.kind !== "tool") return null
  return (
    <details className="timeline-tool">
      <summary>
        {part.tool} <span className={`tool-state tool-state-${part.state}`}>{part.state}</span>
      </summary>
      {part.input === undefined ? null : <pre>{show(part.input)}</pre>}
      {part.output === undefined ? null : <pre>{show(part.output)}</pre>}
      {part.error === undefined ? null : <p className="error">{part.error}</p>}
    </details>
  )
}

function ErrorPart({
  timeline,
  sessionId,
  partId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
}) {
  const part = usePart(timeline, sessionId, partId)
  if (part === undefined || part.kind !== "error") return null
  return (
    <p className="error" role="alert">
      {part.message}
    </p>
  )
}

function ShellPart({
  timeline,
  sessionId,
  partId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
}) {
  const part = usePart(timeline, sessionId, partId)
  if (part === undefined || part.kind !== "shell") return null
  return (
    <pre className="timeline-shell">
      {part.command}
      {part.output === "" ? "" : `\n${part.output}`}
    </pre>
  )
}

function CompactionPart({
  timeline,
  sessionId,
  partId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
}) {
  const part = usePart(timeline, sessionId, partId)
  if (part === undefined || part.kind !== "compaction") return null
  return <p className="muted">Earlier history was compacted.</p>
}

/** One part leaf. Each kind subscribes to its own part, never to the item. */
export function PartView({
  timeline,
  sessionId,
  partId,
  kind,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly partId: TimelinePart["id"]
  readonly kind: TimelinePart["kind"]
}) {
  switch (kind) {
    case "text":
    case "reasoning":
      return <StreamingText timeline={timeline} sessionId={sessionId} partId={partId} />
    case "tool":
      return <ToolPart timeline={timeline} sessionId={sessionId} partId={partId} />
    case "error":
      return <ErrorPart timeline={timeline} sessionId={sessionId} partId={partId} />
    case "shell":
      return <ShellPart timeline={timeline} sessionId={sessionId} partId={partId} />
    case "compaction":
      return <CompactionPart timeline={timeline} sessionId={sessionId} partId={partId} />
  }
}
