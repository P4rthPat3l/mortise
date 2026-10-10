// Unit coverage for the OpenAPI compatibility diff. No engine involved.
import { describe, expect, it } from "vitest"
import { compareSpecs } from "./diff-openapi"

interface OperationFixture {
  readonly path: string
  readonly method: string
  /** Request body object schema, or a `$ref` into `components`. */
  readonly schema?: unknown
}

/** Builds a minimal spec with one operation per entry, keyed by operationId. */
function spec(
  operations: Record<string, OperationFixture>,
  components: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    components: { schemas: components },
    paths: Object.fromEntries(
      Object.entries(operations).map(([operationId, operation]) => [
        operation.path,
        {
          [operation.method]: {
            operationId,
            ...(operation.schema === undefined
              ? {}
              : { requestBody: { content: { "application/json": { schema: operation.schema } } } }),
          },
        },
      ]),
    ),
  }
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
})

describe("compareSpecs", () => {
  it("reports an additive release as compatible", () => {
    const base = spec({ "session.list": { path: "/api/session", method: "get" } })
    const head = spec({
      "session.list": { path: "/api/session", method: "get" },
      "vcs.init": { path: "/api/vcs/init", method: "post" },
    })

    const diff = compareSpecs(base, head)

    expect(diff.baseCount).toBe(1)
    expect(diff.headCount).toBe(2)
    expect(diff.added.map((operation) => operation.operationId)).toEqual(["vcs.init"])
    expect(diff.removed).toEqual([])
    expect(diff.problems).toEqual([])
  })

  it("flags a removed adapter operation as incompatible", () => {
    const base = spec({ "session.form.reply": { path: "/api/form/reply", method: "post" } })

    const diff = compareSpecs(base, spec({}))

    expect(diff.removed).toEqual(["session.form.reply"])
    expect(diff.problems).toEqual(["operation session.form.reply was removed"])
  })

  it("flags a removed request field the adapter sends", () => {
    const path = "/api/session/{sessionID}/prompt"
    const base = spec({
      "session.prompt": { path, method: "post", schema: objectSchema({ id: {}, text: {} }) },
    })
    const head = spec({
      "session.prompt": { path, method: "post", schema: objectSchema({ text: {} }, ["text"]) },
    })

    const diff = compareSpecs(base, head)

    expect(diff.bodyChanges).toEqual([
      { operationId: "session.prompt", removedFields: ["id"], newlyRequired: ["text"] },
    ])
    expect(diff.problems).toEqual(['session.prompt no longer declares request field "id" the adapter sends'])
  })

  it("flags a newly required field the adapter does not send", () => {
    const path = "/api/session/{sessionID}/prompt"
    const base = spec({
      "session.prompt": { path, method: "post", schema: objectSchema({ id: {}, text: {} }, ["text"]) },
    })
    const head = spec({
      "session.prompt": {
        path,
        method: "post",
        schema: objectSchema({ id: {}, text: {}, delivery: {} }, ["text", "delivery"]),
      },
    })

    const diff = compareSpecs(base, head)

    expect(diff.problems).toEqual(['session.prompt now requires request field "delivery" the adapter does not send'])
  })

  it("accepts a newly required field the adapter already sends", () => {
    const path = "/api/session/{sessionID}/prompt"
    const base = spec({
      "session.prompt": { path, method: "post", schema: objectSchema({ id: {}, text: {} }) },
    })
    const head = spec({
      "session.prompt": { path, method: "post", schema: objectSchema({ id: {}, text: {} }, ["id", "text"]) },
    })

    const diff = compareSpecs(base, head)

    expect(diff.bodyChanges).toEqual([
      { operationId: "session.prompt", removedFields: [], newlyRequired: ["id", "text"] },
    ])
    expect(diff.problems).toEqual([])
  })

  it("resolves request body fields through a $ref", () => {
    const path = "/api/session/{sessionID}/form/{formID}/reply"
    const component = "SessionFormReplyInput"
    const base = spec(
      { "session.form.reply": { path, method: "post", schema: { $ref: `#/components/schemas/${component}` } } },
      { [component]: objectSchema({ answer: {} }, ["answer"]) },
    )

    const diff = compareSpecs(base, base)

    expect(diff.bodyChanges).toEqual([])
    expect(diff.problems).toEqual([])
  })

  it("ignores paths without an operationId", () => {
    const base = { paths: { "/api/info": { get: { summary: "no operationId" } } } }

    const diff = compareSpecs(base, base)

    expect(diff.baseCount).toBe(0)
    expect(diff.headCount).toBe(0)
  })
})
