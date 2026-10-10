import { z } from "zod"

/**
 * Every error the channel or its handlers can report. The first seven are produced by the
 * channel itself (T-002); `forbidden_path` and `engine_unreachable` are reserved for the
 * gateway forwarding handler (T-006, FEAT-001 §16). Adding a code is a contract change.
 */
export const channelErrorCodeSchema = z.enum([
  "invalid_message",
  "invalid_input",
  "invalid_output",
  "method_not_found",
  "timeout",
  "aborted",
  "internal",
  "forbidden_path",
  "engine_unreachable",
])

/** One of the {@link channelErrorCodeSchema} values. */
export type ChannelErrorCode = z.infer<typeof channelErrorCodeSchema>

/**
 * The versioned message envelope both ends of a {@link Channel} exchange. `payload` carries the
 * method input, method output or event payload; `error` is present instead when the message
 * reports a failure. Requests and events carry a fresh `id`; responses echo the request id.
 */
export const envelopeSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  type: z.enum(["request", "response", "event"]),
  name: z.string(),
  payload: z.unknown().optional(),
  error: z
    .object({
      code: channelErrorCodeSchema,
      message: z.string(),
    })
    .optional(),
})

/** A validated {@link envelopeSchema} value. */
export type Envelope = z.infer<typeof envelopeSchema>
