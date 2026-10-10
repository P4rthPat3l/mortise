// @mortise/rpc-contracts: Transport-neutral schemas for messages between the UI and the gateway. See README.md.

export {
  type AbortSignalLike,
  type Channel,
  ChannelError,
  type ChannelServer,
  createClient,
  createServer,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type MethodHandler,
  type MethodHandlers,
  type RequestOptions,
  type Transport,
} from "./channel.js"
export { type ChannelErrorCode, channelErrorCodeSchema, type Envelope, envelopeSchema } from "./envelope.js"
export {
  connectionChangedEventSchema,
  type EventName,
  type EventPayload,
  engineEventsEventSchema,
  engineResyncEventSchema,
  events,
} from "./events.js"
export { createMemoryTransportPair } from "./memory.js"
export {
  engineBodySchema,
  engineFetchHeadersSchema,
  engineFetchInputSchema,
  engineFetchPathSchema,
  engineFetchResponseSchema,
  type MethodInput,
  type MethodName,
  type MethodOutput,
  methods,
} from "./methods.js"
export {
  connectionStateSchema,
  engineCapabilitiesSchema,
  engineInfoSchema,
  resyncReasonSchema,
  serverIdSchema,
  serverRefSchema,
  supportStateSchema,
} from "./schemas.js"
