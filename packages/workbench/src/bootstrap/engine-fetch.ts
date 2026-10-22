import type { ServerId } from "@mortise/domain"
import type { Channel } from "@mortise/rpc-contracts"

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

const isHttpMethod = (method: string): method is HttpMethod => HTTP_METHODS.some((candidate) => candidate === method)

const queryOf = (url: URL): Record<string, string | string[]> | undefined => {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    const first = values[0]
    if (first === undefined) continue
    query[key] = values.length === 1 ? first : values
  }
  return Object.keys(query).length === 0 ? undefined : query
}

const headersOf = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, name) => {
    headers[name] = value
  })
  return headers
}

const decodeBody = (
  body: { readonly kind: "text"; readonly text: string } | { readonly kind: "base64"; readonly data: string } | null,
): BodyInit | null => {
  if (body === null) return null
  if (body.kind === "text") return body.text
  const binary = atob(body.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Builds the renderer's `fetch` over the gateway channel's `engine.fetch` (FEAT-004 BR-002). The
 * generated client builds a DOM request; this forwards its method, path, query, headers and UTF-8
 * body, then rebuilds a DOM response from the encoded reply. Credentials are the gateway's job and
 * never appear here.
 */
export function createGatewayFetch(channel: Channel, serverId: ServerId): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const method = request.method.toUpperCase()
    if (!isHttpMethod(method)) throw new Error(`engine.fetch does not support ${request.method}`)

    const text = request.body === null ? null : await request.text()
    const response = await channel.request("engine.fetch", {
      serverId,
      method,
      path: url.pathname,
      query: queryOf(url),
      headers: headersOf(request),
      body: text === null ? null : { kind: "text", text },
    })

    return new Response(decodeBody(response.body), {
      status: response.status,
      headers: new Headers(response.headers),
    })
  }
}
