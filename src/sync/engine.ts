import {
  applyRemote,
  clearDirty,
  getLastSyncAt,
  getSnapshot,
  markAllDirty,
  setLastSyncAt,
  snapshotDirty,
  subscribeStore,
} from "../store"
import { emptyEdges, type TreeEdges } from "../types"
import type {
  PersonWire,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TreeWire,
} from "./types"

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error"

const PUSH_DEBOUNCE_MS = 2000
const PULL_INTERVAL_MS = 60_000

interface Engine {
  start(): void
  stop(): void
  getStatus(): SyncStatus
  /** Force an immediate pull+push cycle (e.g., after sign-in). */
  syncNow(): Promise<void>
  subscribe(listener: (status: SyncStatus) => void): () => void
}

/**
 * Sync engine — runs only while a session is active (App.tsx toggles start/stop
 * on sign-in/out). Pulls on start, on visibility-regain, and every 60s; pushes
 * debounced 2s after each local change. Last-write-wins is enforced server-side;
 * the client just ships dirty records and reconciles on the response.
 */
export function createSyncEngine(): Engine {
  let status: SyncStatus = "idle"
  const listeners = new Set<(s: SyncStatus) => void>()
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let pullTimer: ReturnType<typeof setInterval> | null = null
  let unsubStore: (() => void) | null = null
  let running = false

  function setStatus(s: SyncStatus): void {
    status = s
    for (const l of listeners) l(s)
  }

  function isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine
  }

  function schedulePush(): void {
    if (!running) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      void push()
    }, PUSH_DEBOUNCE_MS)
  }

  async function pull(): Promise<void> {
    if (!isOnline()) {
      setStatus("offline")
      return
    }
    setStatus("syncing")
    try {
      const since = getLastSyncAt() ?? "1970-01-01T00:00:00.000Z"
      const res = await fetch(`/api/sync?since=${encodeURIComponent(since)}`, {
        credentials: "include",
      })
      if (res.status === 401) {
        setStatus("idle")
        return
      }
      if (!res.ok) throw new Error(`pull failed: ${res.status}`)
      const data = (await res.json()) as SyncPullResponse
      applyRemote({ persons: data.own.persons, trees: data.own.trees })
      for (const shared of data.shared) {
        applyRemote({ persons: shared.persons, trees: [shared.tree] })
      }
      setLastSyncAt(data.serverTime)
      setStatus("synced")
    } catch (err) {
      console.error("sync pull failed", err)
      setStatus(isOnline() ? "error" : "offline")
    }
  }

  async function push(): Promise<void> {
    if (!isOnline()) {
      setStatus("offline")
      return
    }
    const dirty = snapshotDirty()
    const snapshot = getSnapshot()
    const now = new Date().toISOString()

    const personWires: PersonWire[] = []
    for (const [id, action] of dirty.persons) {
      const p = snapshot.persons[id]
      if (action === "delete" || !p) {
        personWires.push({
          id,
          name: "",
          updatedAt: p?.updatedAt ?? now,
          deletedAt: now,
        })
      } else {
        personWires.push({
          id,
          name: p.name,
          dob: p.dob,
          dod: p.dod,
          gender: p.gender,
          location: p.location,
          photo: p.photo,
          updatedAt: p.updatedAt ?? now,
        })
      }
    }

    const treeWires: TreeWire[] = []
    for (const [id, action] of dirty.trees) {
      const meta = snapshot.index.find((t) => t.id === id)
      const edges = snapshot.trees[id] ?? emptyEdges()
      if (action === "delete" || !meta) {
        if (!meta) continue // never existed locally; nothing to tell the server
        treeWires.push({
          id,
          name: meta.name,
          edges: emptyEdges() as TreeEdges,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt ?? now,
          deletedAt: now,
          ownerId: meta.ownerId ?? "",
        })
      } else {
        treeWires.push({
          id,
          name: meta.name,
          edges,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt ?? now,
          ownerId: meta.ownerId ?? "",
        })
      }
    }

    if (personWires.length === 0 && treeWires.length === 0) return

    setStatus("syncing")
    try {
      const body: SyncPushRequest = { persons: personWires, trees: treeWires }
      const res = await fetch("/api/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        setStatus("idle")
        return
      }
      if (!res.ok) throw new Error(`push failed: ${res.status}`)
      const result = (await res.json()) as SyncPushResponse

      // Server made a decision on every record we sent — clear dirty for both
      // applied and skipped so we don't loop. Skipped records will be refreshed
      // by the immediate re-pull below.
      clearDirty({
        persons: [...dirty.persons.keys()],
        trees: [...dirty.trees.keys()],
      })

      if (
        result.skipped.persons.length > 0
        || result.skipped.trees.length > 0
      ) {
        await pull()
      }
      setStatus("synced")
    } catch (err) {
      console.error("sync push failed", err)
      setStatus(isOnline() ? "error" : "offline")
    }
  }

  async function fullSync(): Promise<void> {
    const firstLogin = !getLastSyncAt()
    await pull()
    if (firstLogin) {
      // No prior pull → local data has never been pushed. Enqueue everything;
      // the server's LWW dedupes against anything already there.
      markAllDirty()
      await push()
    }
  }

  function onVisibility(): void {
    if (document.visibilityState === "visible") void pull()
  }
  function onOnline(): void {
    setStatus("synced")
    void fullSync()
  }
  function onOffline(): void {
    setStatus("offline")
  }

  return {
    start() {
      if (running) return
      running = true
      void fullSync()
      pullTimer = setInterval(() => void pull(), PULL_INTERVAL_MS)
      document.addEventListener("visibilitychange", onVisibility)
      window.addEventListener("online", onOnline)
      window.addEventListener("offline", onOffline)
      unsubStore = subscribeStore(schedulePush)
    },
    stop() {
      running = false
      if (pushTimer) {
        clearTimeout(pushTimer)
        pushTimer = null
      }
      if (pullTimer) {
        clearInterval(pullTimer)
        pullTimer = null
      }
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      if (unsubStore) {
        unsubStore()
        unsubStore = null
      }
      setStatus("idle")
    },
    async syncNow() {
      await fullSync()
    },
    getStatus() {
      return status
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(status)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Module-level singleton — only one engine per tab. */
let engineSingleton: Engine | null = null

export function getSyncEngine(): Engine {
  if (!engineSingleton) engineSingleton = createSyncEngine()
  return engineSingleton
}
