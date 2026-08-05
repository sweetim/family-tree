/**
 * Persistence coordinator — the owned-state unit for read/write scheduling
 * and the active account id.
 *
 * It composes snapshots from the graph, outbox, sync coordinator, and conflict
 * log. The core commits a validated loaded snapshot into the Zustand graph.
 */

import type { PersistedStore } from "./persistence"
import { loadPersistedStore, savePersistedStore } from "./persistence"
import { applyPersistedConflicts, serializeConflicts } from "./conflicts"
import { serializeCoordinator } from "./coordinator"
import { dirtyState, serializeOutbox } from "./dirty"
import {
  getSnapshot,
  getStoreGeneration,
  hydratePersistedStore,
  notifyListeners,
  setSyncStatus,
  statusFromDirtyState,
} from "./state"
import { RECORD_COLLECTIONS } from "./state-internals"

let persistenceUserId: string | null = null
let persistenceScheduled = false
let persistenceWrite = Promise.resolve()
let persistenceRestore: Promise<void> | undefined
let persistenceRestoreUserId: string | null = null
let persistenceRestoreToken = 0

export function getPersistenceUserId(): string | null {
  return persistenceUserId
}

export function setPersistenceUserId(userId: string | null): void {
  persistenceUserId = userId
}

export function resetPersistenceCoordinator(): void {
  persistenceUserId = null
  persistenceScheduled = false
  persistenceRestore = undefined
  persistenceRestoreUserId = null
  persistenceRestoreToken++
}

export async function restorePersistentStore(userId: string): Promise<void> {
  if (persistenceRestoreUserId === userId && persistenceRestore) {
    await persistenceRestore
    return
  }
  setPersistenceUserId(userId)
  persistenceRestoreUserId = userId
  const generation = getStoreGeneration()
  const token = ++persistenceRestoreToken
  persistenceRestore = (async () => {
    const persisted = await loadPersistedStore(userId)
    if (
      !persisted
      || generation !== getStoreGeneration()
      || persistenceUserId !== userId
      || token !== persistenceRestoreToken
    ) {
      return
    }
    hydratePersistedStore(persisted)
  })()
  await persistenceRestore
}

function persistedSnapshot(): PersistedStore {
  return {
    state: getSnapshot(),
    ...serializeOutbox(),
    ...serializeCoordinator(),
    ...serializeConflicts(),
  }
}

export function persistCurrentStore(): Promise<void> {
  const userId = persistenceUserId
  if (!userId) return Promise.resolve()
  const snapshot = persistedSnapshot()
  persistenceWrite = persistenceWrite
    .catch(() => undefined)
    .then(async () => {
      const persisted = await savePersistedStore(userId, snapshot)
      if (!persisted || persistenceUserId !== userId) return
      applyPersistedConflicts(persisted)
      for (const collection of RECORD_COLLECTIONS) {
        const merged = new Map(persisted.dirty[collection] ?? [])
        for (const [id, current] of dirtyState[collection]) {
          const stored = merged.get(id)
          if (!stored) continue
          if (
            stored.sourceId === current.sourceId
            && stored.revision === current.revision
            && stored.blocked
          ) {
            dirtyState[collection].set(id, { ...current, blocked: true })
          }
        }
      }
      setSyncStatus(statusFromDirtyState())
      notifyListeners()
    })
  return persistenceWrite
}

export function schedulePersistence(): void {
  if (!persistenceUserId || persistenceScheduled) return
  persistenceScheduled = true
  queueMicrotask(() => {
    persistenceScheduled = false
    void persistCurrentStore().catch((error) =>
      console.error("failed to persist sync outbox", error),
    )
  })
}
