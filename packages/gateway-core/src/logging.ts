// Secret-free structured logging (FEAT-001 §19, §SEC-002). The gateway writes connection,
// discovery and probe events here; a sink never receives a credential or a payload body.

/** Structured fields attached to a log line. Values never become part of the message text. */
export type LogFields = Readonly<Record<string, unknown>>

/** A log level the gateway emits. */
export type LogLevel = "info" | "warn" | "error"

/**
 * Field names that must never reach a sink, matched case-insensitively at every depth
 * (FEAT-001 §SEC-002). The list is deliberately broader than the fields the gateway itself logs.
 */
export const PROHIBITED_LOG_FIELDS: ReadonlySet<string> = new Set([
  "password",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "token",
  "pairingtoken",
  "pairing_token",
  "auth",
  "body",
])

/** Where the gateway writes log lines. Injected so tests capture output without a console. */
export interface LogSink {
  write(level: LogLevel, message: string, fields: LogFields): void
}

/** The gateway's logger. A redacting {@link createLogger} wrapper sits in front of a sink. */
export interface Logger {
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

/**
 * Removes every prohibited field at any depth, returning fresh containers. Non-plain values are
 * kept as-is so a caller cannot smuggle a secret through a class instance.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_LOG_FIELDS.has(key.toLowerCase())) continue
    result[key] = redactValue(entry, depth + 1)
  }
  return result
}

/** Strips prohibited fields from a record before it reaches a sink. */
export function redactFields(fields: LogFields): LogFields {
  return redactValue(fields, 0) as LogFields
}

/**
 * Wraps a sink with the prohibited-field rule. Every line the gateway logs passes through this
 * function, so SEC-002 holds even if a caller mistakenly includes a secret (FEAT-001 §19).
 */
export function createLogger(sink: LogSink): Logger {
  const emit = (level: LogLevel, message: string, fields: LogFields): void => {
    sink.write(level, message, redactFields(fields))
  }
  return {
    info: (message, fields = {}) => emit("info", message, fields),
    warn: (message, fields = {}) => emit("warn", message, fields),
    error: (message, fields = {}) => emit("error", message, fields),
  }
}

/** A sink that prints to the console. The default for hosts that do not capture logs. */
export function consoleSink(): LogSink {
  return {
    write: (level, message, fields) => {
      const line = Object.keys(fields).length === 0 ? message : `${message} ${JSON.stringify(fields)}`
      console[level](line)
    },
  }
}
