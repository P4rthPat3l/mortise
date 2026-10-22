import type { Transport } from "@mortise/rpc-contracts"

// The renderer end of the gateway channel (T-009). The port arrives from the preload through
// `window.postMessage`; this file only wraps it, so it stays free of Node and Electron APIs.

/** The subset of the DOM `MessagePort` a channel transport needs. */
export interface RendererMessagePort {
  postMessage(message: unknown): void
  start(): void
  close(): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  removeEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
}

/** Wraps the renderer's DOM `MessagePort` as a {@link Transport}. */
export function rendererTransport(port: RendererMessagePort): Transport {
  let closed = false
  const handlers = new Set<(message: unknown) => void>()
  const receive = (event: { readonly data: unknown }): void => {
    if (closed) return
    for (const handler of [...handlers]) handler(event.data)
  }

  port.addEventListener("message", receive)
  port.start()

  return {
    send(message) {
      if (!closed) port.postMessage(message)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close() {
      if (closed) return
      closed = true
      handlers.clear()
      port.removeEventListener("message", receive)
      port.close()
    },
  }
}
