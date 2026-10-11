// @mortise/gateway-core: Host-neutral engine gateway: discovery, credentials, event stream and request forwarding. See README.md.

export {
  type CapabilityCache,
  type CapabilityDeps,
  createCapabilityCache,
  deriveCapabilities,
} from "./capabilities.js"
export {
  type Clock,
  type Connection,
  type ConnectionDeps,
  createConnection,
  NO_ENGINE_RECHECK_MS,
  type StreamLossReason,
  systemClock,
} from "./connection.js"
export {
  createDiscovery,
  type Discovery,
  type DiscoveryDeps,
  type DiscoveryOutcome,
  defaultFindCli,
  type NoEngineReason,
  openCodeServiceClient,
  SERVICE_COMMAND,
  type ServiceClient,
  type ServiceEndpoint,
  type ServiceOptions,
} from "./discovery.js"
export {
  createEventStream,
  type EngineStreamEvent,
  EVENT_BATCH_INTERVAL_MS,
  type EventStream,
  type EventStreamDeps,
  RECONNECT_BACKOFF_MS,
  STREAM_CONNECT_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamConnectionReporter,
} from "./events.js"
export {
  type ConnectionChange,
  createGateway,
  type Gateway,
  type GatewayInternal,
  type GatewayOptions,
} from "./gateway.js"
export {
  consoleSink,
  createLogger,
  type LogFields,
  type Logger,
  type LogLevel,
  type LogSink,
  PROHIBITED_LOG_FIELDS,
  redactFields,
} from "./logging.js"
export {
  basicAuthHeaders,
  CEILING_VERSION,
  FLOOR_VERSION,
  HIGHEST_TESTED_VERSION,
  type ProbeDeps,
  type ProbeResult,
  probeInfo,
  type ServerInfo,
  SUPPORTED_RANGE,
  serverInfoSchema,
  supportState,
} from "./probe.js"
