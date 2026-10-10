// Compares two OpenCode `openapi.json` files and reports what a new engine release changed.
//
//   bun scripts/diff-openapi.ts <base-openapi.json> <head-openapi.json>
//
// It prints removed and added operations, and per-operation request-body fields that were
// removed or newly required. Exit codes:
//   0  nothing the adapter calls was removed or changed incompatibly
//   1  an adapter operation was removed, or a request field it sends was, or a new required
//      field appeared that the adapter does not send
//   2  bad usage or an unreadable spec
//
// The nightly workflow records the latest engine and diffs it against the newest committed
// fixtures; the exit code is the signal. This script never touches an engine.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Operations the adapter calls, by OpenAPI operationId (see `packages/engine-opencode/README.md`). */
export const ADAPTER_OPERATIONS: readonly string[] = [
  "session.list",
  "session.get",
  "session.create",
  "session.prompt",
  "session.interrupt",
  "session.message.list",
  "permission.request.list",
  "session.permission.reply",
  "form.list",
  "session.form.reply",
  "session.form.cancel",
]

/** Request-body fields the adapter sends, per operationId. Reads and no-body writes are absent. */
export const ADAPTER_REQUEST_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "session.create": ["location", "title", "parentID"],
  "session.prompt": ["id", "text"],
  "session.permission.reply": ["decision", "message"],
  "session.form.reply": ["answer"],
}

/** One operation, keyed in the diff by its OpenAPI `operationId`. */
export interface Operation {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly fields: readonly string[]
  readonly required: readonly string[]
}

/** What changed in one operation's request body between the two specs. */
export interface BodyChange {
  readonly operationId: string
  readonly removedFields: readonly string[]
  readonly newlyRequired: readonly string[]
}

/** The full comparison, ready to print. `problems` is empty when the adapter is compatible. */
export interface OpenApiDiff {
  readonly baseCount: number
  readonly headCount: number
  readonly removed: readonly string[]
  readonly added: readonly Operation[]
  readonly bodyChanges: readonly BodyChange[]
  readonly problems: readonly string[]
}

/** Compares two parsed specs. Pure; the caller reads and prints. */
export function compareSpecs(base: Record<string, unknown>, head: Record<string, unknown>): OpenApiDiff {
  const baseOps = operations(base)
  const headOps = operations(head)
  const removed = [...baseOps.keys()].filter((id) => !headOps.has(id)).sort()
  const added = [...headOps.values()]
    .filter((operation) => !baseOps.has(operation.operationId))
    .sort((left, right) => left.operationId.localeCompare(right.operationId))
  const bodyChanges = diffBodies(baseOps, headOps)
  return {
    baseCount: baseOps.size,
    headCount: headOps.size,
    removed,
    added,
    bodyChanges,
    problems: compatibilityProblems(removed, bodyChanges),
  }
}

function main(argv: readonly string[]): number {
  const [basePath, headPath] = argv
  if (basePath === undefined || headPath === undefined) {
    console.error("usage: bun scripts/diff-openapi.ts <base-openapi.json> <head-openapi.json>")
    return 2
  }

  let base: Record<string, unknown>
  let head: Record<string, unknown>
  try {
    base = load(basePath)
    head = load(headPath)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const diff = compareSpecs(base, head)
  print(basePath, headPath, diff)
  return diff.problems.length > 0 ? 1 : 0
}

function load(path: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const record = asRecord(parsed)
  if (record === undefined) throw new Error(`${path} is not a JSON object`)
  return record
}

function operations(spec: Record<string, unknown>): Map<string, Operation> {
  const result = new Map<string, Operation>()
  const paths = asRecord(spec.paths)
  if (paths === undefined) return result
  for (const [path, methods] of Object.entries(paths)) {
    const methodRecord = asRecord(methods)
    if (methodRecord === undefined) continue
    for (const [method, operation] of Object.entries(methodRecord)) {
      const record = asRecord(operation)
      const operationId = asString(record?.operationId)
      if (record === undefined || operationId === undefined) continue
      const { fields, required } = requestBodyFields(spec, record)
      result.set(operationId, { operationId, method: method.toUpperCase(), path, fields, required })
    }
  }
  return result
}

function requestBodyFields(
  spec: Record<string, unknown>,
  operation: Record<string, unknown>,
): { fields: string[]; required: string[] } {
  const content = asRecord(asRecord(operation.requestBody)?.content)
  const schema = resolveSchema(spec, asRecord(content?.["application/json"])?.schema)
  if (schema === undefined) return { fields: [], required: [] }
  const properties = asRecord(schema.properties)
  return {
    fields: properties === undefined ? [] : Object.keys(properties).sort(),
    required: asArray(schema.required).filter((value): value is string => typeof value === "string"),
  }
}

/** Follows `$ref` chains into `components.schemas`. */
function resolveSchema(spec: Record<string, unknown>, schema: unknown): Record<string, unknown> | undefined {
  let current = asRecord(schema)
  for (let depth = 0; current !== undefined && depth < 10; depth += 1) {
    const ref = asString(current.$ref)
    if (ref === undefined) return current
    const name = ref.split("/").pop()
    const schemas = asRecord(asRecord(spec.components)?.schemas)
    current = name === undefined ? undefined : asRecord(schemas?.[name])
  }
  return current
}

function diffBodies(base: ReadonlyMap<string, Operation>, head: ReadonlyMap<string, Operation>): BodyChange[] {
  const changes: BodyChange[] = []
  for (const [operationId, before] of base) {
    const after = head.get(operationId)
    if (after === undefined) continue
    const removedFields = before.fields.filter((field) => !after.fields.includes(field))
    const newlyRequired = after.required.filter((field) => !before.required.includes(field))
    if (removedFields.length > 0 || newlyRequired.length > 0) {
      changes.push({ operationId, removedFields, newlyRequired })
    }
  }
  return changes.sort((left, right) => left.operationId.localeCompare(right.operationId))
}

function compatibilityProblems(removed: readonly string[], bodyChanges: readonly BodyChange[]): string[] {
  const problems: string[] = []
  for (const operationId of removed) {
    if (ADAPTER_OPERATIONS.includes(operationId)) problems.push(`operation ${operationId} was removed`)
  }
  for (const change of bodyChanges) {
    const sent = ADAPTER_REQUEST_FIELDS[change.operationId]
    if (sent === undefined) continue
    for (const field of change.removedFields) {
      if (sent.includes(field))
        problems.push(`${change.operationId} no longer declares request field "${field}" the adapter sends`)
    }
    for (const field of change.newlyRequired) {
      if (!sent.includes(field))
        problems.push(`${change.operationId} now requires request field "${field}" the adapter does not send`)
    }
  }
  return problems
}

function print(basePath: string, headPath: string, diff: OpenApiDiff): void {
  console.log("OpenAPI diff")
  console.log(`  base: ${basePath}`)
  console.log(`  head: ${headPath}`)
  console.log(`  operations: ${diff.baseCount} -> ${diff.headCount}`)
  console.log("")
  printList("Removed operations", diff.removed)
  printList(
    "Added operations",
    diff.added.map((operation) => `${operation.operationId}  ${operation.method} ${operation.path}`),
  )
  console.log("Request body changes")
  if (diff.bodyChanges.length === 0) {
    console.log("  (none)")
  } else {
    for (const change of diff.bodyChanges) {
      console.log(`  ${change.operationId}`)
      console.log(`    removed fields:   ${list(change.removedFields)}`)
      console.log(`    newly required:   ${list(change.newlyRequired)}`)
    }
  }
  console.log("")
  console.log(
    diff.problems.length === 0
      ? "Adapter verdict: compatible (nothing the adapter calls was removed or changed incompatibly)"
      : `Adapter verdict: INCOMPATIBLE (${diff.problems.length} problem${diff.problems.length === 1 ? "" : "s"})`,
  )
  for (const problem of diff.problems) console.log(`  - ${problem}`)
}

function printList(title: string, values: readonly string[]): void {
  console.log(title)
  if (values.length === 0) console.log("  (none)")
  else for (const value of values) console.log(`  ${value}`)
  console.log("")
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ")
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
