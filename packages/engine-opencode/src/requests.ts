// Pending permissions and forms, and the user's own answers.

import {
  type FormOption,
  type FormQuestion,
  type FormRequest,
  type PendingRequest,
  type PermissionRequest,
  type RequestId,
  requestId,
  type SessionId,
  sessionId,
} from "@mortise/domain"
import type { OpenCodeClient } from "@opencode/client"

/** The reply a permission request accepts. */
export type PermissionDecision = "once" | "always" | "reject"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/**
 * Reduces a wire permission request to a domain one. The wire carries no creation time, so the
 * caller supplies one (the event time, or the read time for a snapshot).
 */
export function decodePermissionRequest(value: unknown, createdAt: number): PermissionRequest | undefined {
  if (!isRecord(value)) return undefined
  const id = asString(value.id)
  const session = asString(value.sessionID)
  const action = asString(value.action)
  if (id === undefined || session === undefined || action === undefined) return undefined
  const resources = Array.isArray(value.resources)
    ? value.resources.filter((resource): resource is string => typeof resource === "string")
    : []
  const message = asString(value.message)
  return {
    kind: "permission",
    id: requestId(id),
    sessionId: sessionId(session),
    title: action,
    detail: message ?? (resources.length > 0 ? resources.join(", ") : undefined),
    createdAt,
  }
}

const toFormType = (value: unknown): FormQuestion["type"] | undefined => {
  switch (value) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "multiselect":
    case "external":
      return value
    default:
      return undefined
  }
}

const toOptions = (value: unknown): FormOption[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const options: FormOption[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const optionValue = asString(item.value)
    const label = asString(item.label)
    if (optionValue === undefined || label === undefined) continue
    options.push({ value: optionValue, label, description: asString(item.description) })
  }
  return options.length > 0 ? options : undefined
}

const toQuestion = (value: unknown): FormQuestion | undefined => {
  if (!isRecord(value)) return undefined
  const key = asString(value.key)
  const type = toFormType(value.type)
  if (key === undefined || type === undefined) return undefined
  return {
    key,
    type,
    title: asString(value.title),
    description: asString(value.description),
    required: typeof value.required === "boolean" ? value.required : undefined,
    placeholder: asString(value.placeholder),
    options: toOptions(value.options),
    url: asString(value.url),
  }
}

/** Reduces a wire form to a domain one, mapping each field to a question. */
export function decodeFormRequest(value: unknown, createdAt: number): FormRequest | undefined {
  if (!isRecord(value)) return undefined
  const id = asString(value.id)
  const session = asString(value.sessionID)
  const title = asString(value.title)
  if (id === undefined || session === undefined || title === undefined) return undefined
  const questions: FormQuestion[] = []
  if (Array.isArray(value.fields)) {
    for (const field of value.fields) {
      const question = toQuestion(field)
      if (question !== undefined) questions.push(question)
    }
  }
  return { kind: "form", id: requestId(id), sessionId: sessionId(session), title, createdAt, questions }
}

/** Where to read pending requests from, and the time to stamp a snapshot with. */
export interface PendingRequestOptions {
  readonly location?: string
  /** Epoch milliseconds for snapshot requests, which carry no wire time. Defaults to now. */
  readonly at?: number
}

/** Lists pending permission requests for a location (or all locations). */
export async function listPermissions(
  client: OpenCodeClient,
  options: PendingRequestOptions = {},
): Promise<PermissionRequest[]> {
  const response = await client.permission.request.list(
    options.location === undefined ? {} : { location: { directory: options.location } },
  )
  const at = options.at ?? Date.now()
  const requests: PermissionRequest[] = []
  for (const wire of response.data) {
    const request = decodePermissionRequest(wire, at)
    if (request !== undefined) requests.push(request)
  }
  return requests
}

/** Lists pending forms for a location (or all locations). */
export async function listForms(client: OpenCodeClient, options: PendingRequestOptions = {}): Promise<FormRequest[]> {
  const response = await client.form.list(
    options.location === undefined ? {} : { location: { directory: options.location } },
  )
  const at = options.at ?? Date.now()
  const requests: FormRequest[] = []
  for (const wire of response.data) {
    const request = decodeFormRequest(wire, at)
    if (request !== undefined) requests.push(request)
  }
  return requests
}

/** Lists everything waiting on the user, so a resync can rebuild the inbox. */
export async function listPendingRequests(
  client: OpenCodeClient,
  options: PendingRequestOptions = {},
): Promise<PendingRequest[]> {
  const [permissions, forms] = await Promise.all([listPermissions(client, options), listForms(client, options)])
  return [...permissions, ...forms]
}

/** Answers a permission request on the user's behalf. */
export async function answerPermission(
  client: OpenCodeClient,
  input: {
    readonly sessionId: SessionId
    readonly requestId: RequestId
    readonly decision: PermissionDecision
    readonly message?: string
  },
): Promise<void> {
  await client.permission.reply({
    sessionID: input.sessionId,
    requestID: input.requestId,
    decision: input.decision,
    message: input.message,
  })
}

/** Answers a form. */
export async function answerForm(
  client: OpenCodeClient,
  input: {
    readonly sessionId: SessionId
    readonly formId: RequestId
    readonly answer: Readonly<Record<string, string | number | boolean | readonly string[]>>
  },
): Promise<void> {
  await client.session.form.reply({
    sessionID: input.sessionId,
    formID: input.formId,
    answer: input.answer,
  })
}

/** Cancels a form without answering it. */
export async function cancelForm(
  client: OpenCodeClient,
  input: { readonly sessionId: SessionId; readonly formId: RequestId; readonly message?: string },
): Promise<void> {
  await client.session.form.cancel({
    sessionID: input.sessionId,
    formID: input.formId,
    message: input.message,
  })
}
