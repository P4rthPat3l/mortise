import type { MessageId, SessionId } from "@mortise/domain"
import { Contract } from "@mortise/sdk"

/** One prompt attempt. `clientMessageId` is generated once and reused on retry. */
export interface PromptRequest {
  readonly sessionId: SessionId
  readonly text: string
  readonly clientMessageId: MessageId
}

/** The prompt service the composition root provides. */
export interface ComposerServiceValue {
  send(request: PromptRequest): Promise<void>
  newMessageId(): MessageId
}

/** The contract the composition root provides to the composer module. */
export const ComposerService = Contract.define<ComposerServiceValue>("composer.service")
