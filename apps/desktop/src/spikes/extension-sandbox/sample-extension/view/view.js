// T-015 spike fixture: the extension half of the postMessage bridge. It has no host objects, no
// network access (CSP connect-src 'none') and no way to reach the parent DOM. It can only send the
// three calls the host accepts.
;(() => {
  const PROTOCOL = "mortise-extension-rpc"
  const VERSION = 1
  const CALL_TIMEOUT_MS = 5_000
  const output = document.getElementById("out")
  let nextId = 0
  const pending = new Map()

  function show(text) {
    if (output !== null) output.textContent = text
  }

  function call(name, params) {
    const id = `ext-${++nextId}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`timeout waiting for ${name}`))
      }, CALL_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      parent.postMessage(
        {
          protocol: PROTOCOL,
          version: VERSION,
          direction: "extension-to-host",
          id,
          kind: "request",
          call: name,
          params,
        },
        "*",
      )
    })
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    const data = event.data
    if (data === null || typeof data !== "object") return
    if (data.protocol !== PROTOCOL || data.version !== VERSION) return
    if (data.direction !== "host-to-extension" || data.kind !== "response") return
    const entry = pending.get(data.id)
    if (entry === undefined) return
    pending.delete(data.id)
    if (data.ok === true) {
      entry.resolve(data.result)
      return
    }
    const error = new Error(typeof data.error?.message === "string" ? data.error.message : "request failed")
    error.code = typeof data.error?.code === "string" ? data.error.code : "unknown"
    entry.reject(error)
  })

  async function init() {
    try {
      await call("commands.register", { id: "acme.tasks.sync", title: "Sync tasks" })
      await call("notify", { kind: "info", message: "view:ready" })
      show("registered acme.tasks.sync and said hello")
    } catch (error) {
      show(`bridge failed: ${String(error)}`)
    }
  }

  function networkFetch() {
    return call("network.fetch", { url: "https://api.acme.example/tasks" })
  }

  async function tryNetworkFetch() {
    try {
      await networkFetch()
      show("network.fetch unexpectedly succeeded")
    } catch (error) {
      show(`network.fetch denied: ${error.code ?? "unknown"}`)
    }
  }

  async function measure(count) {
    for (let index = 0; index < 50; index += 1) {
      await call("notify", { kind: "info", message: "warmup" })
    }
    const samples = new Array(count)
    for (let index = 0; index < count; index += 1) {
      const started = performance.now()
      await call("notify", { kind: "info", message: "ping" })
      samples[index] = performance.now() - started
    }
    return samples
  }

  document.getElementById("notify")?.addEventListener("click", async () => {
    try {
      await call("notify", { kind: "info", message: "hello from the sample view" })
      show("host acknowledged notify")
    } catch (error) {
      show(`notify failed: ${String(error)}`)
    }
  })
  document.getElementById("network")?.addEventListener("click", () => {
    void tryNetworkFetch()
  })

  window.__mortiseSpike = { measure, networkFetch, tryNetworkFetch }
  void init()
})()
