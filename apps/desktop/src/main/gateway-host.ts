// The Electron-side gateway host (FEAT-001 §24 Phase 4, T-009). It creates the app's single
// gateway once, gives every window a private MessagePort channel wired to that gateway, and tears a
// window's channel down when the window closes. Electron itself stays in `index.ts`: this module
// takes the window adapter, channel factory and gateway factory as arguments, so the host logic
// runs under Vitest with a fake gateway and a worker-thread MessageChannel.

import {
  createForwardHandler,
  type EventStream,
  type ForwardConnectionReporter,
  type Gateway,
  type Logger,
  type ServiceEndpoint,
} from "@mortise/gateway-core"
import { createServer, type MethodHandlers } from "@mortise/rpc-contracts"
import { type MainMessagePort, mainTransport } from "./transport.js"

/** The channel name the main process posts and the renderer accepts. */
export const CHANNEL_NAME = "mortise:channel"

/**
 * The gateway surface the host needs. The real `Gateway` from `@mortise/gateway-core` satisfies it;
 * tests pass a fake that counts subscriptions and never touches an engine.
 */
export interface GatewayHostGateway
  extends Pick<Gateway, "start" | "servers" | "connection" | "onConnectionChange" | "dispose"> {
  readonly internal: {
    /** The shared per-server stream; every window subscribes through it. */
    readonly events: Pick<EventStream, "subscribe">
    /** The adopted endpoint, or `undefined`. Carries the password, so only forwarding sees it. */
    endpoint(): ServiceEndpoint | undefined
    /** The reporter forwarding uses for a `401`. */
    readonly connection: ForwardConnectionReporter
  }
}

/** The two ends of one window's port pair. */
export interface HostChannel<TPort> {
  /** Stays in main and backs the channel server. */
  readonly main: MainMessagePort
  /** Transferred to the renderer with `webContents.postMessage`. */
  readonly windowPort: TPort
}

/**
 * The window operations the host attaches to, so this module never imports Electron. `index.ts`
 * adapts a `BrowserWindow` to it; tests pass a recorder.
 */
export interface HostWindow<TPort> {
  onDidFinishLoad(listener: () => void): void
  onClosed(listener: () => void): void
  sendChannel(port: TPort): void
}

/** Dependencies of {@link createGatewayHost}. */
export interface GatewayHostOptions<TPort> {
  /** Builds the single gateway. Called once, when the app is ready. */
  readonly createGateway: () => GatewayHostGateway
  /** Creates a port pair. Production passes `new MessageChannelMain()`. */
  readonly createChannel: () => HostChannel<TPort>
  /** Forwarding's network call, injected so tests stay offline. */
  readonly fetch: typeof globalThis.fetch
  readonly logger: Logger
}

/** The app's gateway and its per-window channels. */
export interface GatewayHost<TPort> {
  /** Create the gateway and begin discovery. Safe to call twice. */
  start(): void
  /** Attach to a window; each load gets a fresh private channel. */
  attach(window: HostWindow<TPort>): void
  /** Close every window channel and stop the gateway. Never stops the engine. */
  dispose(): void
}

interface WindowChannel<TPort> {
  readonly port: TPort
  close(): void
}

/** Builds a channel server wired to the gateway's handlers and events for one window. */
function openWindowChannel<TPort>(
  gateway: GatewayHostGateway,
  options: GatewayHostOptions<TPort>,
): WindowChannel<TPort> {
  const channel = options.createChannel()
  const handlers: Partial<MethodHandlers> = {
    "servers.list": () => gateway.servers(),
    "connection.get": ({ serverId }) => gateway.connection(serverId),
    "engine.fetch": createForwardHandler({
      fetch: options.fetch,
      logger: options.logger,
      endpoint: () => gateway.internal.endpoint(),
      connection: gateway.internal.connection,
    }),
  }
  const server = createServer(mainTransport(channel.main), handlers)

  const unsubscribeChange = gateway.onConnectionChange((change) => server.emit("connection.changed", change))
  const unsubscribeEvents = gateway.internal.events.subscribe((event) => {
    // A window's connection is only live while its channel holds this subscription (T-005
    // CASE-013): the stream is shared and stops when the last window unsubscribes.
    if (event.type === "engine.events") {
      server.emit("engine.events", {
        serverId: event.serverId,
        generation: event.generation,
        events: [...event.events],
      })
      return
    }
    server.emit("engine.resync", {
      serverId: event.serverId,
      generation: event.generation,
      reason: event.reason,
    })
  })

  return {
    port: channel.windowPort,
    close() {
      unsubscribeChange()
      unsubscribeEvents()
      server.close()
    },
  }
}

/** Creates the desktop gateway host. Call {@link GatewayHost.start} when the app is ready. */
export function createGatewayHost<TPort>(options: GatewayHostOptions<TPort>): GatewayHost<TPort> {
  let gateway: GatewayHostGateway | undefined
  let disposed = false
  const channels = new Set<WindowChannel<TPort>>()

  const closeChannel = (channel: WindowChannel<TPort>): void => {
    if (!channels.delete(channel)) return
    channel.close()
  }

  return {
    start() {
      if (disposed || gateway !== undefined) return
      const created = options.createGateway()
      gateway = created
      // Discovery runs alongside the window skeleton, so a slow engine never delays the first paint.
      void created.start().catch((cause: unknown) => {
        options.logger.error("gateway start failed", { error: cause instanceof Error ? cause.message : "unknown" })
      })
    },

    attach(window) {
      if (disposed) return
      let current: WindowChannel<TPort> | undefined

      const closeCurrent = (): void => {
        if (current === undefined) return
        const closing = current
        current = undefined
        closeChannel(closing)
      }

      window.onDidFinishLoad(() => {
        if (disposed || gateway === undefined) return
        // A reload replaces the previous document; its port is dead, so start a fresh channel.
        closeCurrent()
        const next = openWindowChannel(gateway, options)
        current = next
        channels.add(next)
        window.sendChannel(next.port)
      })

      window.onClosed(closeCurrent)
    },

    dispose() {
      if (disposed) return
      disposed = true
      for (const channel of [...channels]) closeChannel(channel)
      gateway?.dispose()
      gateway = undefined
    },
  }
}
