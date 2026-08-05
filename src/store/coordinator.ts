/**
 * Sync coordinator — the owned-state unit for the push loop, tree sync, and
 * device/mutation identity.
 *
 * Owns its singletons (`pushInFlight`, `pushInFlightGeneration`,
 * `treeSyncInFlight`, `treeFreshSyncInFlight`, `pendingMutation`, `deviceId`,
 * `storeInstanceId`, `mutationIdsByBatch`, `clearedMutationIds`) and exposes a
 * lifecycle API (`serializeCoordinator` / `hydrateCoordinator` /
 * `resetCoordinator` / `getPendingMutation`) so the core lifecycle in
 * `state.ts` never reaches in to reassign them. The graph (`state`), outbox
 * (`dirtyState`), and conflict log are read from their owning units; the store
 * generation token (`storeGeneration`) stays in the core as cross-cutting
 * infrastructure.
 */

import type {
  SyncChangePage,
  SyncMutationResponse,
  SyncPushRequest,
} from "../sync/types"
import type { PersistedPendingMutation, PersistedStore } from "./persistence"
import type { DirtyState } from "./state"
import {
  clearDirty,
  dirtyState,
  snapshotDirty,
} from "./dirty"
import {
  blockOperation,
  getConflictResolutionInFlight,
  hasNewerDirtyRecords,
  recreateMissingParentDependencies,
  snapshotOperationConflict,
} from "./conflicts"
import {
  applyAliases,
  acknowledgeApplied,
  applyRemote,
} from "./remote"
import {
  RECORD_COLLECTIONS,
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_BATCH_RECORDS,
  buildPushWires,
  dirtyBatchKey,
  firstPendingOperation,
  hasAcknowledgedIds,
  newId,
  operationExceedsRecordLimits,
  persistableDirty,
  restoredDirty,
  takeDirtyBatch,
} from "./state-internals"
import {
  fetchFullPull,
  fetchTreeManifest,
  fetchTreeSnapshot,
} from "./sync-transport"
import {
  applyFullPull,
  applyTreeManifest,
  applyTreeSnapshot,
  getSnapshot,
  getStoreGeneration,
  setSyncStatus,
  statusFromDirtyState,
  update,
} from "./state"
import {
  getPersistenceUserId,
  persistCurrentStore,
  schedulePersistence,
} from "./persistence-coordinator"

// ---------------------------------------------------------------------------
// Owned singletons.
// ---------------------------------------------------------------------------

let pushInFlight: Promise<void> | undefined
let pushInFlightGeneration = -1
const treeSyncInFlight = new Map<string, Promise<void>>()
const treeFreshSyncInFlight = new Map<string, Promise<void>>()
export let pendingMutation: PersistedPendingMutation | undefined
let deviceId = newId()
export const storeInstanceId = newId()
export const mutationIdsByBatch = new Map<string, string>()
const clearedMutationIds = new Set<string>()

// ---------------------------------------------------------------------------
// Read accessors + lifecycle.
// ---------------------------------------------------------------------------

export function getPendingMutation(): PersistedPendingMutation | undefined {
  return pendingMutation
}

export function getDeviceId(): string {
  return deviceId
}

export function serializeCoordinator() {
  return {
    deviceId,
    mutationIdsByBatch: [...mutationIdsByBatch],
    pendingMutation,
    clearedMutationIds: [...clearedMutationIds],
  }
}

export function hydrateCoordinator(persisted: PersistedStore): void {
  deviceId = persisted.deviceId || newId()
  mutationIdsByBatch.clear()
  for (const [key, value] of persisted.mutationIdsByBatch) {
    mutationIdsByBatch.set(key, value)
  }
  pendingMutation = persisted.pendingMutation
  clearedMutationIds.clear()
  for (const id of persisted.clearedMutationIds ?? []) {
    clearedMutationIds.add(id)
  }
}

export function resetCoordinator(): void {
  pushInFlight = undefined
  pushInFlightGeneration = -1
  treeSyncInFlight.clear()
  treeFreshSyncInFlight.clear()
  pendingMutation = undefined
  deviceId = newId()
  mutationIdsByBatch.clear()
  clearedMutationIds.clear()
}

// ---------------------------------------------------------------------------
// Cross-tab sync lock.
// ---------------------------------------------------------------------------

export function runWithCrossTabSyncLock<Value>(
  execute: () => Promise<Value>,
): Promise<Value> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(
        `family-tree-sync:${getPersistenceUserId() ?? "anonymous"}`,
        execute,
      )
    : execute()
}

/** The push promise for the current store generation, if one is in flight. */
export function activePushPromise(): Promise<void> | undefined {
  return pushInFlightGeneration === getStoreGeneration()
    ? pushInFlight
    : undefined
}

// ---------------------------------------------------------------------------
// Push loop.
// ---------------------------------------------------------------------------

async function runPushLoop(generation: number): Promise<void> {
  let authoritativePullNeeded = false
  while (generation === getStoreGeneration()) {
    let dirty: DirtyState
    let request: SyncPushRequest
    let batchKey: string
    let mutationId: string
    let operationId: string | undefined
    if (pendingMutation) {
      dirty = restoredDirty(pendingMutation.dirty)
      request = pendingMutation.records
      batchKey = pendingMutation.batchKey
      mutationId = pendingMutation.mutationId
      operationId = firstPendingOperation(dirty)
    } else {
      const pending = snapshotDirty()
      operationId = firstPendingOperation(pending)
      if (operationExceedsRecordLimits(pending, operationId)) {
        blockOperation(pending, operationId)
        return
      }
      dirty = takeDirtyBatch(pending, MAX_SYNC_BATCH_RECORDS)
      request = buildPushWires(getSnapshot(), dirty, new Date().toISOString())
      if (
        RECORD_COLLECTIONS.every(
          (collection) => request[collection].length === 0,
        )
      ) {
        return
      }
      const serializedRequest = JSON.stringify(request)
      if (
        new TextEncoder().encode(serializedRequest).byteLength
        > MAX_SYNC_BATCH_BYTES
      ) {
        blockOperation(pending, operationId)
        return
      }
      batchKey = dirtyBatchKey(dirty)
      mutationId = mutationIdsByBatch.get(batchKey) ?? newId()
      mutationIdsByBatch.set(batchKey, mutationId)
      pendingMutation = {
        batchKey,
        mutationId,
        records: request,
        dirty: persistableDirty(dirty),
      }
    }

    try {
      await persistCurrentStore()
      const response = await fetch("/api/mutations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2,
          deviceId,
          mutationId,
          records: request,
        }),
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`push failed: ${response.status}`)
      }
      const result = (await response.json()) as SyncMutationResponse
      if (generation !== getStoreGeneration()) return
      pendingMutation = undefined
      clearedMutationIds.add(mutationId)
      mutationIdsByBatch.delete(batchKey)
      schedulePersistence()
      acknowledgeApplied(result, dirty)
      clearDirty(result.applied, dirty)
      applyAliases(result)
      if (result.status === "conflict") {
        console.warn("sync mutation rejected", {
          mutationId,
          reason: result.conflict?.reason,
          retryable: result.conflict?.retryable,
          skipped: Object.fromEntries(
            RECORD_COLLECTIONS.map((collection) => [
              collection,
              result.skipped[collection],
            ]).filter(([, ids]) => (ids as string[]).length > 0),
          ),
          sent: request,
        })
        recreateMissingParentDependencies(dirty, operationId, result)
        snapshotOperationConflict(dirty, operationId, result)
      }
      for (const collection of RECORD_COLLECTIONS) {
        for (const id of result.skipped[collection]) {
          const current = dirtyState[collection].get(id)
          const sent = dirty[collection].get(id)
          if (current && sent && current.revision === sent.revision) {
            dirtyState[collection].set(id, { ...current, blocked: true })
          }
        }
      }
      schedulePersistence()
      setSyncStatus(statusFromDirtyState())
      authoritativePullNeeded ||= hasAcknowledgedIds(result.skipped)
      if (hasNewerDirtyRecords(dirty)) continue
      if (authoritativePullNeeded) {
        const pull = await fetchFullPull()
        if (generation !== getStoreGeneration()) return
        if (hasNewerDirtyRecords(dirty)) continue
        applyFullPull(pull)
      }
      return
    } catch (error) {
      console.error("sync push failed", error)
      setSyncStatus("offline")
      return
    }
  }
}

export function pushDirty(): Promise<void> {
  if (pushInFlight && pushInFlightGeneration === getStoreGeneration()) {
    return pushInFlight
  }
  const generation = getStoreGeneration()
  const execute = async () => {
    const conflictResolution = getConflictResolutionInFlight()
    if (conflictResolution) await conflictResolution
    if (generation !== getStoreGeneration()) return
    await runWithCrossTabSyncLock(() => runPushLoop(generation))
  }
  const execution = execute()
  const promise = execution.finally(() => {
    if (pushInFlight === promise) pushInFlight = undefined
  })
  pushInFlight = promise
  pushInFlightGeneration = generation
  return promise
}

export function synchronizePending(): Promise<void> {
  return pushDirty()
}

// ---------------------------------------------------------------------------
// Tree synchronization.
// ---------------------------------------------------------------------------

async function runTreeSynchronization(treeId: string): Promise<void> {
  const generation = getStoreGeneration()
  let cursor = getSnapshot().index.find((tree) => tree.id === treeId)?.cursor
  if (!cursor) {
    const snapshot = await fetchTreeSnapshot(treeId)
    if (generation === getStoreGeneration()) applyTreeSnapshot(snapshot)
    return
  }
  let hasMore = true
  while (hasMore) {
    const parameters = new URLSearchParams({ treeId, cursor, limit: "100" })
    const response = await fetch(`/api/changes?${parameters}`, {
      credentials: "include",
    })
    if (generation !== getStoreGeneration()) return
    if (response.status === 404) {
      const manifest = await fetchTreeManifest()
      if (generation === getStoreGeneration()) applyTreeManifest(manifest)
      return
    }
    if (response.status === 410) {
      const snapshot = await fetchTreeSnapshot(treeId)
      if (generation === getStoreGeneration()) applyTreeSnapshot(snapshot)
      return
    }
    if (!response.ok) throw new Error(`changes failed: ${response.status}`)
    const page = (await response.json()) as SyncChangePage
    if (generation !== getStoreGeneration()) return
    for (const change of page.changes) applyRemote(change.records)
    cursor = page.cursor
    hasMore = page.hasMore
    update(
      (previous) => ({
        ...previous,
        index: previous.index.map((tree) =>
          tree.id === treeId
            ? {
                ...tree,
                cursor: page.cursor,
                syncVersion: page.changes.at(-1)?.version ?? tree.syncVersion,
              }
            : tree,
        ),
      }),
      { remote: true },
    )
  }
}

export function synchronizeTree(treeId: string): Promise<void> {
  const existing = treeSyncInFlight.get(treeId)
  if (existing) return existing
  return startTreeSynchronization(treeId)
}

function startTreeSynchronization(treeId: string): Promise<void> {
  const synchronization = runTreeSynchronization(treeId).finally(() => {
    if (treeSyncInFlight.get(treeId) === synchronization) {
      treeSyncInFlight.delete(treeId)
    }
  })
  treeSyncInFlight.set(treeId, synchronization)
  return synchronization
}

export async function synchronizeTreeFresh(
  treeId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  const activeFreshSynchronization = treeFreshSyncInFlight.get(treeId)
  if (activeFreshSynchronization) return activeFreshSynchronization
  const existing = treeSyncInFlight.get(treeId)
  const generation = getStoreGeneration()
  const synchronization = (async () => {
    if (existing) await existing
    const snapshot = await fetchTreeSnapshot(treeId)
    if (generation !== getStoreGeneration()) return
    applyTreeSnapshot(snapshot)
    setSyncStatus(statusFromDirtyState())
  })().finally(() => {
    if (treeSyncInFlight.get(treeId) === synchronization) {
      treeSyncInFlight.delete(treeId)
    }
    if (treeFreshSyncInFlight.get(treeId) === synchronization) {
      treeFreshSyncInFlight.delete(treeId)
    }
  })
  treeSyncInFlight.set(treeId, synchronization)
  treeFreshSyncInFlight.set(treeId, synchronization)
  return synchronization
}
