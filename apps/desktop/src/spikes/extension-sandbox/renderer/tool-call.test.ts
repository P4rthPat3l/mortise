import { describe, expect, it } from "vitest"
import { matchToolRenderer, renderToolCall, type ToolRendererContribution } from "./tool-call.js"

const renderer: ToolRendererContribution = {
  match: "mcp.acme.*",
  title: "{input.id}",
  body: "table",
  columns: ["id", "title", "status"],
}

describe("declarative tool-call renderer", () => {
  it("matches the manifest glob and rejects other tools", () => {
    expect(matchToolRenderer([renderer], "mcp.acme.tasks")).toBe(renderer)
    expect(matchToolRenderer([renderer], "mcp.other.tasks")).toBeUndefined()
  })

  it("renders the title template and one row from the tool input", () => {
    const view = renderToolCall(renderer, {
      name: "mcp.acme.tasks",
      input: { id: "T-42", title: "Ship sandbox", status: "open" },
    })
    expect(view).toEqual({
      title: "T-42",
      columns: ["id", "title", "status"],
      rows: [["T-42", "Ship sandbox", "open"]],
    })
  })

  it("renders missing and object values without throwing", () => {
    const view = renderToolCall(renderer, { name: "mcp.acme.tasks", input: { id: "T-1", title: { text: "x" } } })
    expect(view.title).toBe("T-1")
    expect(view.rows[0]).toEqual(["T-1", '{"text":"x"}', ""])
  })
})
