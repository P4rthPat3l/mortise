// Time-ordered client message ids, compatible with OpenCode's `Identifier.ascending()`.

import { type MessageId, messageId } from "@mortise/domain"

/**
 * Base-62 alphabet `Identifier` uses: digits, then uppercase, then lowercase. Ordering of the
 * time prefix, not this suffix, decides id order.
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const ID_LENGTH = 26
/** `Identifier` encodes the timestamp in six big-endian bytes, twelve hex characters. */
const TIME_HEX_LENGTH = 12
/** `timestamp * 4096 + counter`, so ids created in one millisecond still sort. */
const TIMESTAMP_SHIFT = 4096n

let lastTimestamp = 0
let counter = 0

/**
 * Creates an id for one message the client is about to send, matching OpenCode's
 * `Identifier.ascending()` format: `msg_` plus twelve hex characters of
 * `timestamp * 4096 + counter` and fourteen random base-62 characters. Ids sort in creation
 * order, so the engine accepts a reused id as the same admission.
 *
 * @param now epoch milliseconds; defaults to `Date.now()`. Injectable for tests.
 */
export function newMessageId(now: number = Date.now()): MessageId {
  if (now !== lastTimestamp) {
    lastTimestamp = now
    counter = 0
  }
  counter++

  const value = BigInt(now) * TIMESTAMP_SHIFT + BigInt(counter)
  let time = ""
  for (let index = 0; index < TIME_HEX_LENGTH / 2; index++) {
    const byte = Number((value >> BigInt(40 - 8 * index)) & 0xffn)
    time += byte.toString(16).padStart(2, "0")
  }

  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH - TIME_HEX_LENGTH))
  let random = ""
  for (const byte of bytes) random += CHARS.charAt(byte % CHARS.length)

  return messageId(`msg_${time}${random}`)
}
