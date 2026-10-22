/// <reference types="node" />

import { MessageChannel, type MessagePort } from "node:worker_threads"
import { createClient, createServer, serverIdSchema, type Transport } from "@mortise/rpc-contracts"
import { afterEach, describe, expect, it } from "vitest"
import { type RendererMessagePort, rendererTransport } from "./transport.js"

const SERVER = { id: serverIdSchema.parse("shared"), label: "OpenCode", kind: "shared" as const, url: "" }

const cleanups: Array<() => void> = []

function onCleanup(cleanup: () => void): void {
  cleanups.push(cleanup)
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Adapts a worker-thread port to the DOM `MessagePort` surface the renderer transport consumes. */
function rendererPort(end: MessagePort): RendererMessagePort {
  const listeners = new Set<(event: { readonly data: unknown }) => void>()
  end.on("message", (value) => {
    for (const listener of [...listeners]) listener({ data: value })
  })
  return {
    postMessage: (message) => end.postMessage(message),
    start: () => end.start(),
    close: () => end.close(),
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
  }
}

/** A plain transport on the other end, standing in for the main process. */
function nodeTransport(end: MessagePort): Transport {
  const handlers = new Set<(message: unknown) => void>()
  end.on("message", (value) => {
    for (const handler of [...handlers]) handler(value)
  })
  end.start()
  return {
    send: (message) => end.postMessage(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close: () => {
      handlers.clear()
      end.close()
    },
  }
}

function pair(): { main: MessagePort; renderer: RendererMessagePort } {
  const channel = new MessageChannel()
  onCleanup(() => {
    channel.port1.close()
    channel.port2.close()
  })
  return { main: channel.port1, renderer: rendererPort(channel.port2) }
}

describe("renderer transport", () => {
  it("AC-1: carries structured messages and stops delivering after unsubscribe", async () => {
    const { main, renderer } = pair()
    const transport = rendererTransport(renderer)
    const received: unknown[] = []
    const unsubscribe = transport.onMessage((message) => received.push(message))

    main.postMessage({ v: 1, id: "msg_1", type: "event", name: "engine.events", payload: { events: [1, 2] } })
    await waitFor(() => received.length === 1, "first message")
    expect(received[0]).toEqual({
      v: 1,
      id: "msg_1",
      type: "event",
      name: "engine.events",
      payload: { events: [1, 2] },
    })

    unsubscribe()
    main.postMessage({ ignored: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(1)
  })

  it("AC-1: runs the channel client over the DOM port against a server on the main end", async () => {
    const { main, renderer } = pair()
    const server = createServer(nodeTransport(main), { "servers.list": () => [SERVER] })
    const client = createClient(rendererTransport(renderer))
    onCleanup(() => {
      client.close()
      server.close()
    })

    await expect(client.request("servers.list", undefined)).resolves.toEqual([SERVER])
  })

  it("AC-1: close removes the message listener and stops sends", async () => {
    const { renderer } = pair()
    const transport = rendererTransport(renderer)
    const received: unknown[] = []
    transport.onMessage((message) => received.push(message))
    transport.close()
    transport.send({ after: "close" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(0)
  })
})
