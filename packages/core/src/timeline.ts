import type { MessageId, PartId, SessionId, TimelineItem, TimelinePart, TimelinePatch } from "@mortise/domain"
import type { ReadableStore } from "./store.js"

/** Identity and render kind of one part, stable while the part's membership does not change. */
export interface TimelinePartRef {
  readonly id: PartId
  readonly kind: TimelinePart["kind"]
}

/**
 * A normalized, framework-free timeline. Everything is keyed by session, message and part id, so a
 * text delta notifies one part instead of the session or the window.
 *
 * `subscribe`/`getSnapshot` report a version number for coarse consumers. React leaves use the
 * narrow subscriptions: item order per session, part membership per item, and a single part value.
 */
export interface TimelineStore extends ReadableStore<number> {
  /** Sessions the store holds, in first-seen order. */
  sessionIds(): readonly SessionId[]
  subscribeSessionIds(listener: () => void): () => void
  /** Item order for one session, stable until an item is added, removed or reordered. */
  itemIds(sessionId: SessionId): readonly MessageId[]
  subscribeItemIds(sessionId: SessionId, listener: () => void): () => void
  /** One item value. A text delta replaces this object but does not notify the item's subscribers. */
  item(sessionId: SessionId, messageId: MessageId): TimelineItem | undefined
  /** Every item in order. The array is stable until an item or part changes; for tests and snapshots. */
  items(sessionId: SessionId): readonly TimelineItem[]
  /** Part membership of one item, stable while only part values change. */
  partRefs(sessionId: SessionId, messageId: MessageId): readonly TimelinePartRef[]
  subscribePartRefs(sessionId: SessionId, messageId: MessageId, listener: () => void): () => void
  /** One part value. */
  part(sessionId: SessionId, partId: PartId): TimelinePart | undefined
  subscribePart(sessionId: SessionId, partId: PartId, listener: () => void): () => void
  /** Applies one translated patch. An unknown message or part target is ignored. */
  apply(sessionId: SessionId, patch: TimelinePatch): void
  /** Replaces a session with a snapshot, dropping items the snapshot does not name. */
  replace(sessionId: SessionId, items: readonly TimelineItem[]): void
  /** Merges a snapshot page: matching items are replaced, new ones are added, older ones stay. */
  merge(sessionId: SessionId, items: readonly TimelineItem[]): void
  /** Applies many patches with one notification per affected key. */
  batch(fn: () => void): void
}

interface SessionState {
  readonly items: Map<MessageId, TimelineItem>
  readonly refs: Map<MessageId, readonly TimelinePartRef[]>
  readonly parts: Map<PartId, TimelinePart>
  order: readonly MessageId[]
  snapshot: readonly TimelineItem[] | undefined
}

const EMPTY_IDS: readonly MessageId[] = Object.freeze([])
const EMPTY_SESSIONS: readonly SessionId[] = Object.freeze([])
const EMPTY_PARTS: readonly TimelinePartRef[] = Object.freeze([])
const EMPTY_ITEMS: readonly TimelineItem[] = Object.freeze([])

const itemKey = (sessionId: SessionId, messageId: MessageId): string => `${sessionId}\u0000${messageId}`
const partKey = (sessionId: SessionId, partId: PartId): string => `${sessionId}\u0000${partId}`

const refsOf = (item: TimelineItem): readonly TimelinePartRef[] =>
  Object.freeze(item.parts.map((part) => ({ id: part.id, kind: part.kind })))

const sameRefs = (left: readonly TimelinePartRef[], right: readonly TimelinePartRef[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((ref, index) => {
    const other = right[index]
    return other !== undefined && other.id === ref.id && other.kind === ref.kind
  })
}

const sameIds = (left: readonly MessageId[], right: readonly MessageId[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

const compareItems = (left: TimelineItem, right: TimelineItem): number =>
  left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt - right.createdAt

/** Creates a {@link TimelineStore}. */
export function createTimelineStore(): TimelineStore {
  const sessions = new Map<SessionId, SessionState>()
  let sessionOrder: readonly SessionId[] = EMPTY_SESSIONS
  let version = 0

  const globalListeners = new Set<() => void>()
  const sessionListeners = new Set<() => void>()
  const itemIdsListeners = new Map<SessionId, Set<() => void>>()
  const refsListeners = new Map<string, Set<() => void>>()
  const partListeners = new Map<string, Set<() => void>>()

  const dirtyItemIds = new Set<SessionId>()
  const dirtyRefs = new Set<string>()
  const dirtyParts = new Set<string>()
  let dirtySessions = false
  let dirtyGlobal = false
  let batchDepth = 0

  const notify = (listeners: Set<() => void>): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener()
    }
  }

  const flush = (): void => {
    if (batchDepth > 0) return
    if (dirtyGlobal) {
      dirtyGlobal = false
      version += 1
      notify(globalListeners)
    }
    if (dirtySessions) {
      dirtySessions = false
      notify(sessionListeners)
    }
    for (const sessionId of dirtyItemIds) {
      const listeners = itemIdsListeners.get(sessionId)
      if (listeners !== undefined) notify(listeners)
    }
    dirtyItemIds.clear()
    for (const key of dirtyRefs) {
      const listeners = refsListeners.get(key)
      if (listeners !== undefined) notify(listeners)
    }
    dirtyRefs.clear()
    for (const key of dirtyParts) {
      const listeners = partListeners.get(key)
      if (listeners !== undefined) notify(listeners)
    }
    dirtyParts.clear()
  }

  const markPart = (sessionId: SessionId, partId: PartId): void => {
    dirtyParts.add(partKey(sessionId, partId))
    dirtyGlobal = true
  }

  const markRefs = (sessionId: SessionId, messageId: MessageId): void => {
    dirtyRefs.add(itemKey(sessionId, messageId))
    dirtyGlobal = true
  }

  const markItems = (): void => {
    dirtyGlobal = true
  }

  const ensureSession = (sessionId: SessionId): SessionState => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionState = {
      items: new Map(),
      refs: new Map(),
      parts: new Map(),
      order: EMPTY_IDS,
      snapshot: undefined,
    }
    sessions.set(sessionId, created)
    sessionOrder = Object.freeze([...sessionOrder, sessionId])
    dirtySessions = true
    dirtyGlobal = true
    return created
  }

  const reorder = (sessionId: SessionId, session: SessionState): void => {
    const sorted = [...session.items.values()].sort(compareItems).map((item) => item.id)
    if (sameIds(session.order, sorted)) return
    session.order = Object.freeze(sorted)
    session.snapshot = undefined
    dirtyItemIds.add(sessionId)
    dirtyGlobal = true
  }

  const updateRefs = (sessionId: SessionId, session: SessionState, messageId: MessageId): boolean => {
    const item = session.items.get(messageId)
    if (item === undefined) {
      if (!session.refs.has(messageId)) return false
      session.refs.delete(messageId)
      markRefs(sessionId, messageId)
      return true
    }
    const next = refsOf(item)
    const previous = session.refs.get(messageId)
    if (previous !== undefined && sameRefs(previous, next)) return false
    session.refs.set(messageId, next)
    markRefs(sessionId, messageId)
    return true
  }

  const putItem = (session: SessionState, item: TimelineItem): void => {
    session.items.set(item.id, item)
    session.snapshot = undefined
  }

  const replaceParts = (session: SessionState, item: TimelineItem, nextParts: readonly TimelinePart[]): void => {
    putItem(session, { ...item, parts: nextParts } as TimelineItem)
  }

  const apply = (sessionId: SessionId, patch: TimelinePatch): void => {
    const session = ensureSession(sessionId)
    switch (patch.type) {
      case "item.added": {
        putItem(session, patch.item)
        for (const part of patch.item.parts) session.parts.set(part.id, part)
        updateRefs(sessionId, session, patch.item.id)
        reorder(sessionId, session)
        markItems()
        return
      }
      case "item.patched": {
        const item = session.items.get(patch.messageId)
        if (item === undefined) return
        putItem(session, { ...item, createdAt: patch.createdAt })
        reorder(sessionId, session)
        markItems()
        return
      }
      case "item.removed": {
        const item = session.items.get(patch.messageId)
        if (item === undefined) return
        for (const part of item.parts) {
          session.parts.delete(part.id)
          markPart(sessionId, part.id)
        }
        session.items.delete(patch.messageId)
        session.snapshot = undefined
        updateRefs(sessionId, session, patch.messageId)
        reorder(sessionId, session)
        markItems()
        return
      }
      case "part.added": {
        const item = session.items.get(patch.messageId)
        if (item === undefined) return
        session.parts.set(patch.part.id, patch.part)
        replaceParts(session, item, [...item.parts, patch.part])
        updateRefs(sessionId, session, patch.messageId)
        markPart(sessionId, patch.part.id)
        markItems()
        return
      }
      case "part.text.appended": {
        const item = session.items.get(patch.messageId)
        const part = session.parts.get(patch.partId)
        if (item === undefined || part === undefined) return
        if (part.kind !== "text" && part.kind !== "reasoning") return
        const next = { ...part, text: part.text + patch.delta }
        session.parts.set(next.id, next)
        replaceParts(
          session,
          item,
          item.parts.map((entry) => (entry.id === next.id ? next : entry)),
        )
        markPart(sessionId, next.id)
        markItems()
        return
      }
      case "part.updated": {
        const item = session.items.get(patch.messageId)
        const current = session.parts.get(patch.part.id)
        if (item === undefined || current === undefined) return
        session.parts.set(patch.part.id, patch.part)
        replaceParts(
          session,
          item,
          item.parts.map((entry) => (entry.id === patch.part.id ? patch.part : entry)),
        )
        updateRefs(sessionId, session, patch.messageId)
        markPart(sessionId, patch.part.id)
        markItems()
        return
      }
      case "part.patched": {
        const item = session.items.get(patch.messageId)
        const part = session.parts.get(patch.partId)
        if (item === undefined || part === undefined || part.kind !== "tool") return
        const next = { ...part, ...patch.patch }
        session.parts.set(next.id, next)
        replaceParts(
          session,
          item,
          item.parts.map((entry) => (entry.id === next.id ? next : entry)),
        )
        markPart(sessionId, next.id)
        markItems()
        return
      }
    }
  }

  const buildSnapshot = (session: SessionState): readonly TimelineItem[] => {
    if (session.snapshot !== undefined) return session.snapshot
    const items = session.order.flatMap((id) => {
      const item = session.items.get(id)
      return item === undefined ? [] : [item]
    })
    session.snapshot = Object.freeze(items)
    return session.snapshot
  }

  const replace = (sessionId: SessionId, items: readonly TimelineItem[]): void => {
    const previous = sessions.get(sessionId)
    if (previous !== undefined) {
      for (const part of previous.parts.values()) markPart(sessionId, part.id)
      for (const messageId of previous.refs.keys()) markRefs(sessionId, messageId)
    }
    const next: SessionState = {
      items: new Map(),
      refs: new Map(),
      parts: new Map(),
      order: EMPTY_IDS,
      snapshot: undefined,
    }
    for (const item of items) {
      next.items.set(item.id, item)
      for (const part of item.parts) next.parts.set(part.id, part)
      next.refs.set(item.id, refsOf(item))
    }
    next.order = Object.freeze([...next.items.values()].sort(compareItems).map((item) => item.id))
    next.snapshot = undefined
    if (previous === undefined) {
      sessions.set(sessionId, next)
      sessionOrder = Object.freeze([...sessionOrder, sessionId])
      dirtySessions = true
    } else {
      sessions.set(sessionId, next)
    }
    for (const item of items) markRefs(sessionId, item.id)
    dirtyItemIds.add(sessionId)
    markItems()
    flush()
  }

  const merge = (sessionId: SessionId, items: readonly TimelineItem[]): void => {
    const session = ensureSession(sessionId)
    for (const item of items) {
      const previous = session.items.get(item.id)
      if (previous !== undefined) {
        for (const part of previous.parts) {
          if (!item.parts.some((entry) => entry.id === part.id)) {
            session.parts.delete(part.id)
            markPart(sessionId, part.id)
          }
        }
      }
      putItem(session, item)
      for (const part of item.parts) {
        session.parts.set(part.id, part)
        markPart(sessionId, part.id)
      }
      updateRefs(sessionId, session, item.id)
    }
    reorder(sessionId, session)
    markItems()
    flush()
  }

  return {
    getSnapshot: () => version,
    subscribe(listener) {
      globalListeners.add(listener)
      return () => {
        globalListeners.delete(listener)
      }
    },
    sessionIds: () => sessionOrder,
    subscribeSessionIds(listener) {
      sessionListeners.add(listener)
      return () => {
        sessionListeners.delete(listener)
      }
    },
    itemIds: (sessionId) => sessions.get(sessionId)?.order ?? EMPTY_IDS,
    subscribeItemIds(sessionId, listener) {
      let listeners = itemIdsListeners.get(sessionId)
      if (listeners === undefined) {
        listeners = new Set()
        itemIdsListeners.set(sessionId, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    item: (sessionId, messageId) => sessions.get(sessionId)?.items.get(messageId),
    items: (sessionId) => {
      const session = sessions.get(sessionId)
      return session === undefined ? EMPTY_ITEMS : buildSnapshot(session)
    },
    partRefs: (sessionId, messageId) => sessions.get(sessionId)?.refs.get(messageId) ?? EMPTY_PARTS,
    subscribePartRefs(sessionId, messageId, listener) {
      const key = itemKey(sessionId, messageId)
      let listeners = refsListeners.get(key)
      if (listeners === undefined) {
        listeners = new Set()
        refsListeners.set(key, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    part: (sessionId, partId) => sessions.get(sessionId)?.parts.get(partId),
    subscribePart(sessionId, partId, listener) {
      const key = partKey(sessionId, partId)
      let listeners = partListeners.get(key)
      if (listeners === undefined) {
        listeners = new Set()
        partListeners.set(key, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    apply(sessionId, patch) {
      apply(sessionId, patch)
      flush()
    },
    replace,
    merge,
    batch(fn) {
      batchDepth += 1
      try {
        fn()
      } finally {
        batchDepth -= 1
        flush()
      }
    },
  }
}
