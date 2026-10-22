// T-015 spike: the declarative tool-call renderer. The host reads a manifest contribution and
// renders it; no extension code runs. Only the shapes this sample uses are supported.

export interface ToolRendererContribution {
  readonly match: string
  readonly title: string
  readonly body: "table"
  readonly columns: readonly string[]
}

export interface ToolCall {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

export interface ToolCallView {
  readonly title: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
  return new RegExp(`^${escaped}$`)
}

/** Returns the first contribution whose `match` glob covers the tool name. */
export function matchToolRenderer(
  renderers: readonly ToolRendererContribution[],
  toolName: string,
): ToolRendererContribution | undefined {
  return renderers.find((renderer) => patternToRegExp(renderer.match).test(toolName))
}

function templateValue(template: string, input: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{input\.([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = input[key]
    return value === undefined || value === null ? "" : String(value)
  })
}

function cellValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Renders one tool call from a matched contribution. */
export function renderToolCall(contribution: ToolRendererContribution, call: ToolCall): ToolCallView {
  return {
    title: templateValue(contribution.title, call.input),
    columns: contribution.columns,
    rows: [contribution.columns.map((column) => cellValue(call.input[column]))],
  }
}
