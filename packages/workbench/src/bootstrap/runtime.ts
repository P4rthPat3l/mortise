import {
  createStore,
  createTimelineStore,
  type ReadableStore,
  Registries,
  type Store,
  type TimelineStore,
} from "@mortise/core"
import type { ConnectionState, DomainEvent, PendingRequest, SessionId, SessionSummary } from "@mortise/domain"
import { createAdapter } from "@mortise/engine-opencode"
import type { Channel } from "@mortise/rpc-contracts"
import { createModuleHost, Module, type ModuleHost, type Setup } from "@mortise/sdk"
import type { ComponentType } from "react"
import { ComposerService, type ComposerServiceValue } from "../modules/composer/contract"
import { definition as composerDefinition } from "../modules/composer/module"
import { setup as composerSetup } from "../modules/composer/setup"
import { ComposerView } from "../modules/composer/view"
import { type SessionListState, SessionsService, type SessionsValue } from "../modules/sessions/contract"
import { definition as sessionsDefinition } from "../modules/sessions/module"
import { setup as sessionsSetup } from "../modules/sessions/setup"
import { SessionsView } from "../modules/sessions/view"
import { type TimelineLoadState, TimelineService, type TimelineServiceValue } from "../modules/timeline/contract"
import { definition as timelineDefinition } from "../modules/timeline/module"
import { setup as timelineSetup } from "../modules/timeline/setup"
import { TimelineView } from "../modules/timeline/view"
import { createGatewayFetch } from "./engine-fetch"
import { type FrameScheduler, frameScheduler } from "./frame"

/** The composition root's options. Everything with a side effect is injectable for tests. */
export interface WorkbenchRuntimeOptions {
  readonly channel: Channel
  readonly scheduler?: FrameScheduler
  /** Messages per page. The latest page is what a load or resync reads. */
  readonly pageSize?: number
  readonly now?: () => number
}

/** The views the composition root supplies to the shell. The shell names no module. */
export interface WorkbenchViews {
  readonly sessions: ComponentType
  readonly timeline: ComponentType
  readonly composer: ComponentType
}

/** What the window needs after boot: stores, modules and connection state. */
export interface WorkbenchRuntime {
  readonly host: ModuleHost
  readonly views: WorkbenchViews
  readonly sessions: SessionsValue
  readonly timeline: TimelineStore
  readonly timelineService: TimelineServiceValue
  readonly composerService: ComposerServiceValue
  readonly connection: ReadableStore<ConnectionState>
  readonly pendingRequests: ReadableStore<readonly PendingRequest[]>
  /** Completes once the first session list and timeline read have settled. Never rejects. */
  readonly ready: Promise<void>
  dispose(): void
}

const errorMessage = (cause: unknown, fallback: string): string => (cause instanceof Error ? cause.message : fallback)

/**
 * Builds the workbench over one gateway channel (FEAT-004). It creates the adapter exactly here,
 * owns the frame-batched event path and the resync procedure, and registers the three modules with
 * their services. `dispose` never touches the engine or the channel.
 */
export async function createWorkbenchRuntime(options: WorkbenchRuntimeOptions): Promise<WorkbenchRuntime> {
  const { channel } = options
  const scheduler = options.scheduler ?? frameScheduler
  const pageSize = options.pageSize ?? 50

  const servers = await channel.request("servers.list", undefined)
  const server = servers[0]
  if (server === undefined) throw new Error("No OpenCode engine found")

  const adapter = createAdapter({
    serverId: server.id,
    baseUrl: "http://engine.invalid/",
    fetch: createGatewayFetch(channel, server.id),
  })

  const sessionStore: Store<SessionListState> = createStore<SessionListState>({
    status: "loading",
    sessions: [],
  })
  const timeline = createTimelineStore()
  const statusStore: Store<Readonly<Record<string, TimelineLoadState>>> = createStore<
    Readonly<Record<string, TimelineLoadState>>
  >({})
  const connection: Store<ConnectionState> = createStore<ConnectionState>({ phase: "discovering" })
  const pendingRequests: Store<readonly PendingRequest[]> = createStore<readonly PendingRequest[]>([])

  let disposed = false
  let resyncGeneration = 0
  let scheduled = false
  const queue: DomainEvent[] = []
  const activeIds = new Set<SessionId>()
  const loaded = new Set<SessionId>()
  const unsubscribers: Array<() => void> = []

  const setActivity = (sessions: readonly SessionSummary[]): readonly SessionSummary[] =>
    sessions.map((session) => (activeIds.has(session.id) ? { ...session, activity: "running" as const } : session))

  const refreshSessions = async (): Promise<void> => {
    sessionStore.update((state) => ({
      ...state,
      status: state.sessions.length === 0 ? "loading" : state.status,
    }))
    let sessions: SessionSummary[]
    try {
      sessions = await adapter.listSessions()
    } catch (cause) {
      if (disposed) return
      sessionStore.update((state) => ({
        ...state,
        status: "error",
        error: errorMessage(cause, "Could not load sessions"),
      }))
      return
    }
    if (disposed) return
    try {
      const active = await adapter.activeSessions()
      activeIds.clear()
      for (const id of active) activeIds.add(id)
    } catch {
      // The list is still usable without the activity snapshot; keep the previous marks.
    }
    sessionStore.update((state) => {
      const selected =
        state.selectedId !== undefined && sessions.some((session) => session.id === state.selectedId)
          ? state.selectedId
          : sessions[0]?.id
      return { status: "ready", sessions: setActivity(sessions), selectedId: selected, error: undefined }
    })
  }

  const refreshPending = async (): Promise<void> => {
    try {
      const next = await adapter.pendingRequests()
      if (!disposed) pendingRequests.update(() => next)
    } catch {
      // Pending requests are not rendered yet; a failure must not clear what is already known.
    }
  }

  const loadTimeline = async (sessionId: SessionId): Promise<void> => {
    loaded.add(sessionId)
    statusStore.update((state) => ({ ...state, [sessionId]: { status: "loading" } }))
    try {
      const items = await adapter.timeline(sessionId, { limit: pageSize, order: "desc" })
      if (disposed) return
      timeline.replace(sessionId, items)
      statusStore.update((state) => ({ ...state, [sessionId]: { status: "ready" } }))
    } catch (cause) {
      if (disposed) return
      statusStore.update((state) => ({
        ...state,
        [sessionId]: { status: "error", error: errorMessage(cause, "Could not load this timeline") },
      }))
    }
  }

  const mergeTimeline = async (sessionId: SessionId, generation: number): Promise<void> => {
    try {
      const items = await adapter.timeline(sessionId, { limit: pageSize, order: "desc" })
      if (disposed || generation !== resyncGeneration) return
      timeline.merge(sessionId, items)
      statusStore.update((state) => ({ ...state, [sessionId]: { status: "ready" } }))
    } catch (cause) {
      if (disposed || generation !== resyncGeneration) return
      statusStore.update((state) => ({
        ...state,
        [sessionId]: { status: "error", error: errorMessage(cause, "Could not load this timeline") },
      }))
    }
  }

  const resync = async (): Promise<void> => {
    resyncGeneration += 1
    const generation = resyncGeneration
    await Promise.all([refreshSessions(), refreshPending()])
    if (disposed || generation !== resyncGeneration) return
    const visible = new Set<SessionId>(loaded)
    const selected = sessionStore.getSnapshot().selectedId
    if (selected !== undefined) visible.add(selected)
    await Promise.all([...visible].map((sessionId) => mergeTimeline(sessionId, generation)))
  }

  const select = (sessionId: SessionId): void => {
    sessionStore.update((state) => ({ ...state, selectedId: sessionId }))
    if (!loaded.has(sessionId)) void loadTimeline(sessionId)
  }

  const upsertSession = (session: SessionSummary): void => {
    sessionStore.update((state) => {
      const index = state.sessions.findIndex((entry) => entry.id === session.id)
      const sessions =
        index === -1
          ? [session, ...state.sessions]
          : state.sessions.map((entry, position) => (position === index ? { ...entry, ...session } : entry))
      return { ...state, sessions, selectedId: state.selectedId ?? session.id }
    })
  }

  const setSessionActivity = (sessionId: SessionId, status: SessionSummary["activity"]): void => {
    sessionStore.update((state) => ({
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, activity: status } : session,
      ),
    }))
  }

  const applyBatch = (events: readonly DomainEvent[]): void => {
    let resyncRequested = false
    sessionStore.batch(() => {
      timeline.batch(() => {
        for (const event of events) {
          switch (event.type) {
            case "session.changed":
              upsertSession(event.session)
              break
            case "session.activity":
              setSessionActivity(event.sessionId, event.status)
              break
            case "timeline.patch":
              timeline.apply(event.sessionId, event.patch)
              break
            case "request.opened":
              pendingRequests.update((current) => [
                ...current.filter((request) => request.id !== event.request.id),
                event.request,
              ])
              break
            case "request.closed":
              pendingRequests.update((current) => current.filter((request) => request.id !== event.requestId))
              break
            case "connection.changed":
              connection.update(() => event.state)
              break
            case "resync":
              resyncRequested = true
              break
          }
        }
      })
    })
    if (resyncRequested) void resync()
  }

  const enqueue = (events: readonly DomainEvent[]): void => {
    if (events.length === 0) return
    queue.push(...events)
    if (scheduled) return
    scheduled = true
    scheduler.schedule(() => {
      scheduled = false
      const batch = queue.splice(0)
      if (!disposed) applyBatch(batch)
    })
  }

  unsubscribers.push(
    channel.subscribe("engine.events", (payload) => {
      if (payload.serverId !== server.id) return
      enqueue(payload.events.flatMap((wire) => adapter.translate(wire)))
    }),
  )
  unsubscribers.push(
    channel.subscribe("engine.resync", (payload) => {
      if (payload.serverId !== server.id) return
      void resync()
    }),
  )
  unsubscribers.push(
    channel.subscribe("connection.changed", (payload) => {
      if (payload.serverId !== server.id) return
      connection.update(() => payload.state)
    }),
  )

  const sessionsValue: SessionsValue = {
    store: sessionStore,
    refresh: () => void refreshSessions(),
    select,
  }
  const timelineService: TimelineServiceValue = {
    store: timeline,
    status: statusStore,
    load: (sessionId) => void loadTimeline(sessionId),
  }
  const composerService: ComposerServiceValue = {
    send: (request) => adapter.prompt(request),
    newMessageId: () => adapter.newMessageId(options.now?.()),
  }

  const kernel = Module.define({
    id: "workbench.kernel",
    provides: {
      sessions: SessionsService,
      timeline: TimelineService,
      composer: ComposerService,
    },
  })
  const kernelSetup: Setup<typeof kernel> = (ctx) => {
    ctx.provide(SessionsService, sessionsValue)
    ctx.provide(TimelineService, timelineService)
    ctx.provide(ComposerService, composerService)
  }

  const host = createModuleHost({ core: { registries: new Registries() } })
  host.register(kernel, kernelSetup)
  host.register(sessionsDefinition, sessionsSetup)
  host.register(timelineDefinition, timelineSetup)
  host.register(composerDefinition, composerSetup)

  const ready = (async () => {
    await refreshSessions()
    if (disposed) return
    const selected = sessionStore.getSnapshot().selectedId
    if (selected !== undefined) await loadTimeline(selected)
    if (!disposed) await refreshPending()
  })()

  void channel
    .request("connection.get", { serverId: server.id })
    .then((state) => {
      if (!disposed) connection.update(() => state)
    })
    .catch(() => {
      // The event stream still reports transitions; a failed snapshot is not fatal for the list.
    })

  return {
    host,
    views: { sessions: SessionsView, timeline: TimelineView, composer: ComposerView },
    sessions: sessionsValue,
    timeline,
    timelineService,
    composerService,
    connection,
    pendingRequests,
    ready,
    dispose() {
      if (disposed) return
      disposed = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      host.dispose()
    },
  }
}
