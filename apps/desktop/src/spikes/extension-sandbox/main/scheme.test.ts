import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EXTENSION_CSP } from "../shared/constants.js"
import { handleExtensionRequest } from "./scheme.js"

describe("mortise-ext scheme handler", () => {
  let root: string
  let outside: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mortise-ext-root-"))
    outside = await mkdtemp(join(tmpdir(), "mortise-ext-outside-"))
    await mkdir(join(root, "view"), { recursive: true })
    await writeFile(join(root, "view", "index.html"), "<!doctype html><title>sample</title>")
    await writeFile(join(root, "package.json"), '{"name":"sample"}')
    await writeFile(join(outside, "canary.txt"), "CANARY")
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it("serves a package file with the mandated CSP", async () => {
    const response = await handleExtensionRequest(root, "mortise-ext://acme.tasks/view/index.html")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-security-policy")).toBe(EXTENSION_CSP)
    expect(await response.text()).toContain("sample")
  })

  it("returns 404 for an unknown file, a directory and another extension host", async () => {
    expect((await handleExtensionRequest(root, "mortise-ext://acme.tasks/view/missing.html")).status).toBe(404)
    expect((await handleExtensionRequest(root, "mortise-ext://acme.tasks/view")).status).toBe(404)
    expect((await handleExtensionRequest(root, "mortise-ext://other.tasks/package.json")).status).toBe(404)
    expect((await handleExtensionRequest(root, "https://acme.tasks/package.json")).status).toBe(404)
  })

  it("returns 400 for malformed percent encoding and a null byte", async () => {
    expect((await handleExtensionRequest(root, "mortise-ext://acme.tasks/%zz")).status).toBe(400)
    expect((await handleExtensionRequest(root, "mortise-ext://acme.tasks/%00")).status).toBe(400)
  })

  it("refuses encoded traversal out of the package root", async () => {
    const target = join(outside, "canary.txt")
    const segments = relative(root, target).split("/")
    const upCount = segments.filter((segment) => segment === "..").length
    const tail = segments.filter((segment) => segment !== "..").join("%2f")
    const encoded = `${"%2e%2e%2f".repeat(upCount)}${tail}`
    const response = await handleExtensionRequest(root, `mortise-ext://acme.tasks/${encoded}`)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain("CANARY")
  })

  it("refuses a symlink that points outside the package root", async () => {
    await symlink(join(outside, "canary.txt"), join(root, "view", "canary.txt"))
    const response = await handleExtensionRequest(root, "mortise-ext://acme.tasks/view/canary.txt")
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain("CANARY")
  })
})
