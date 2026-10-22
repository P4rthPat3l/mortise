import type { MessageId, SessionId } from "@mortise/domain"
import { useModule } from "@mortise/sdk"
import { useCallback, useState, useSyncExternalStore } from "react"
import type { SessionsValue } from "../sessions/contract"
import type { ComposerServiceValue } from "./contract"
import { definition } from "./module"

interface PendingPrompt {
  readonly sessionId: SessionId
  readonly clientMessageId: MessageId
  readonly text: string
}

/** The prompt box. One id per attempt, kept across a failure so Retry is idempotent. */
export function ComposerPanel({
  sessions,
  service,
}: {
  readonly sessions: SessionsValue
  readonly service: ComposerServiceValue
}) {
  const state = useSyncExternalStore(
    useCallback((listener) => sessions.store.subscribe(listener), [sessions.store]),
    useCallback(() => sessions.store.getSnapshot(), [sessions.store]),
  )
  const [text, setText] = useState("")
  const [pending, setPending] = useState<PendingPrompt>()
  const [error, setError] = useState<string>()

  const send = async (attempt?: PendingPrompt): Promise<void> => {
    const target = attempt?.sessionId ?? state.selectedId
    if (target === undefined) return
    const request = attempt ?? {
      sessionId: target,
      clientMessageId: service.newMessageId(),
      text,
    }
    if (request.text.trim() === "") return
    setPending(request)
    setError(undefined)
    try {
      await service.send(request)
      setText("")
      setPending(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "the prompt did not reach the engine")
    }
  }

  const canSend =
    (pending !== undefined || state.selectedId !== undefined) && (pending !== undefined || text.trim() !== "")

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        void send(pending)
      }}
    >
      <label className="composer-label" htmlFor="composer-input">
        Prompt
      </label>
      <textarea
        id="composer-input"
        className="composer-input"
        value={text}
        rows={3}
        placeholder={state.selectedId === undefined ? "Select a session first" : "Ask the agent…"}
        onChange={(event) => {
          setText(event.target.value)
          setPending(undefined)
          setError(undefined)
        }}
      />
      {error === undefined ? null : (
        <div className="composer-error">
          <p className="error" role="alert">
            Could not send: {error}
          </p>
          {pending === undefined ? null : (
            <button type="button" onClick={() => void send(pending)}>
              Retry
            </button>
          )}
        </div>
      )}
      <button type="submit" disabled={!canSend}>
        Send
      </button>
    </form>
  )
}

/** The module's view: resolves its services from the module context. */
export function ComposerView() {
  const ctx = useModule(definition)
  return <ComposerPanel sessions={ctx.requires.sessions} service={ctx.requires.service} />
}
