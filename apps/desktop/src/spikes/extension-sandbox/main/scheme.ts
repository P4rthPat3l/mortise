// T-015 spike: serves one extension package over mortise-ext://. Path resolution is deliberately
// strict: decode once, resolve inside the package root, follow symlinks, then require the real path
// to stay under the real root. Electron owns the protocol registration; this module only turns a
// URL into a Response, so it runs under Vitest without Electron.

import { readFile, realpath } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { EXTENSION_CSP, EXTENSION_ID, EXTENSION_SCHEME } from "../shared/constants.js"

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-security-policy": EXTENSION_CSP,
      "x-content-type-options": "nosniff",
    },
  })
}

function isInside(root: string, target: string): boolean {
  return target.startsWith(root + sep)
}

/**
 * Resolves and serves one file from the extension package rooted at `root`. Returns 400 for a
 * malformed URL, 403 for an escape attempt or a symlink that leaves the package, 404 for anything
 * missing, and 200 with the mandated CSP header for a package file.
 */
export async function handleExtensionRequest(root: string, requestUrl: string): Promise<Response> {
  const url = new URL(requestUrl)
  if (url.protocol !== `${EXTENSION_SCHEME}:` || url.host !== EXTENSION_ID) return textResponse(404, "not found")

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return textResponse(400, "bad request")
  }
  if (pathname.includes("\0")) return textResponse(400, "bad request")

  const rootReal = await realpath(root)
  const target = resolve(rootReal, `.${pathname}`)
  if (!isInside(rootReal, target)) return textResponse(403, "forbidden")

  let realTarget: string
  try {
    realTarget = await realpath(target)
  } catch {
    return textResponse(404, "not found")
  }
  if (!isInside(rootReal, realTarget)) return textResponse(403, "forbidden")

  let body: Buffer
  try {
    body = await readFile(realTarget)
  } catch {
    return textResponse(404, "not found")
  }

  const type = CONTENT_TYPES[extname(realTarget)] ?? "application/octet-stream"
  return new Response(Uint8Array.from(body), {
    status: 200,
    headers: {
      "content-type": type,
      "content-security-policy": EXTENSION_CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  })
}
