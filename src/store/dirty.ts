/**
 * Outbox — the owned-state unit for per-record dirty tracking.
 *
 * Owns its singletons (`dirtyState`, `nextRevision`, `clearedDirtyTokens`)
 * and exposes a lifecycle API (`serializeOutbox` / `hydrateOutbox` /
 * `resetOutbox` / `replaceDirtyState` / `setNextRevision`) so the core
 * lifecycle in `state.ts` never reaches in to reassign them. The in-flight
 * mutation and device identity are owned by the sync coordinator and read
 * here.
 */

import type { PersistedStore } from "./persistence"
import {
  type DirtyAction,
  type DirtyCollection,
  type DirtyIds,
  type DirtyRecord,
  type DirtyState,
  type GlobalState,
} from "./state"
import { getPendingMutation, storeInstanceId } from "./coordinator"
import { schedulePersistence } from "./persistence-coordinator"
import {
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_BATCH_RECORDS,
  MAX_SYNC_RECORDS_PER_COLLECTION,
  emptyDirtyState,
  newId,
  RECORD_COLLECTIONS,
} from "./state-internals"

// ---------------------------------------------------------------------------
// Owned outbox singletons + lifecycle.
// ---------------------------------------------------------------------------

export let dirtyState = emptyDirtyState()
let nextRevision = 1
export const clearedDirtyTokens = new Set<string>()

/** Bump and return the next optimistic-concurrency revision. */
export function bumpRevision(): number {
  return nextRevision++
}

/** Replace the entire dirty map (used by the full-epoch reset/replay). */
export function replaceDirtyState(next: DirtyState): void {
  dirtyState = next
}

export function setNextRevision(value: number): void {
  nextRevision = value
}

export function resetOutbox(): void {
  dirtyState = emptyDirtyState()
  nextRevision = 1
  clearedDirtyTokens.clear()
}

/** Restore the dirty map, revision counter, and cleared tokens from disk. */
export function hydrateOutbox(persisted: PersistedStore): void {
  dirtyState = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map(persisted.dirty[collection] ?? []),
    ]),
  ) as DirtyState
  clearedDirtyTokens.clear()
  for (const token of persisted.clearedDirtyTokens ?? []) {
    clearedDirtyTokens.add(token)
  }
  nextRevision = Math.max(1, persisted.nextRevision)
}

export function serializeOutbox() {
  return {
    dirty: Object.fromEntries(
      RECORD_COLLECTIONS.map((collection) => [
        collection,
        [...dirtyState[collection]],
      ]),
    ) as PersistedStore["dirty"],
    nextRevision,
    clearedDirtyTokens: [...clearedDirtyTokens],
  }
}

export function markDirty(
  collection: DirtyCollection,
  id: string,
  action: DirtyAction,
  baseRevision?: number,
  operationId?: string,
): void {
  const current = dirtyState[collection].get(id)
  const isPending = Boolean(
    getPendingMutation()?.dirty[collection].some(
      ([pendingId, pending]) =>
        pendingId === id && pending.revision === current?.revision,
    ),
  )
  if (
    action === "delete"
    && current?.action === "upsert"
    && current.baseRevision === undefined
    && !current.blocked
    && !isPending
  ) {
    const token = dirtyToken(collection, id, current)
    if (token) clearedDirtyTokens.add(token)
    dirtyState[collection].delete(id)
    return
  }
  dirtyState[collection].set(id, {
    action,
    revision: bumpRevision(),
    baseRevision: current?.blocked
      ? baseRevision
      : (current?.baseRevision ?? baseRevision),
    operationId,
    sourceId: storeInstanceId,
    changedAt: Date.now(),
  })
}

export function dirtyToken(
  collection: DirtyCollection,
  id: string,
  record: DirtyRecord,
): string | undefined {
  return record.sourceId
    ? JSON.stringify([collection, id, record.sourceId, record.revision])
    : undefined
}

function stampRecordMap<T extends { updatedAt: string; revision?: number }>(
  previous: Record<string, T>,
  next: Record<string, T>,
  collection: Exclude<DirtyCollection, "persons" | "trees">,
  now: string,
  operationId: string,
  enqueueDeletes = true,
): Record<string, T> {
  if (previous === next) return next
  let stamped = next
  let cloned = false
  for (const [id, record] of Object.entries(next)) {
    if (record === previous[id]) continue
    if (!cloned) {
      stamped = { ...next }
      cloned = true
    }
    stamped[id] = { ...record, updatedAt: now }
    markDirty(collection, id, "upsert", previous[id]?.revision, operationId)
  }
  for (const id of Object.keys(previous)) {
    if (!next[id]) {
      if (enqueueDeletes) {
        markDirty(collection, id, "delete", previous[id]?.revision, operationId)
      } else {
        const current = dirtyState[collection].get(id)
        const token = current ? dirtyToken(collection, id, current) : undefined
        if (token) clearedDirtyTokens.add(token)
        dirtyState[collection].delete(id)
      }
    }
  }
  return stamped
}

/** Stamp and enqueue only the normalized records whose object references changed. */
export function stampAndEnqueue(
  previous: GlobalState,
  next: GlobalState,
): GlobalState {
  if (previous === next) return next
  const changedValues = <T>(
    previousRecords: Record<string, T>,
    nextRecords: Record<string, T>,
  ): unknown[] => [
    ...Object.entries(nextRecords)
      .filter(([id, record]) => record !== previousRecords[id])
      .map(([, record]) => record),
    ...Object.keys(previousRecords)
      .filter((id) => !nextRecords[id])
      .map((id) => ({ id, deleted: true })),
  ]
  const previousTrees = Object.fromEntries(
    previous.index.map((tree) => [tree.id, tree]),
  )
  const nextTrees = Object.fromEntries(
    next.index.map((tree) => [tree.id, tree]),
  )
  const operationCollections = [
    changedValues(previous.persons, next.persons),
    changedValues(previousTrees, nextTrees),
    changedValues(previous.treeMembers, next.treeMembers),
    changedValues(previous.unions, next.unions),
    changedValues(previous.unionEvents, next.unionEvents),
    changedValues(previous.treeUnions, next.treeUnions),
    changedValues(
      previous.parentChildRelationships,
      next.parentChildRelationships,
    ),
    changedValues(
      previous.treeParentChildRelationships,
      next.treeParentChildRelationships,
    ),
  ]
  const operationRecordCount = operationCollections.reduce(
    (total, records) => total + records.length,
    0,
  )
  const operationBytes = new TextEncoder().encode(
    JSON.stringify(operationCollections),
  ).byteLength
  if (
    operationCollections.some(
      (records) => records.length > MAX_SYNC_RECORDS_PER_COLLECTION,
    )
    || operationRecordCount > MAX_SYNC_BATCH_RECORDS
    || operationBytes > MAX_SYNC_BATCH_BYTES
  ) {
    throw new Error("This change is too large to synchronize atomically.")
  }
  const now = new Date().toISOString()
  const operationId = newId()

  let persons = next.persons
  if (previous.persons !== next.persons) {
    let cloned = false
    for (const [id, person] of Object.entries(next.persons)) {
      if (person === previous.persons[id]) continue
      if (!cloned) {
        persons = { ...next.persons }
        cloned = true
      }
      const previousPerson = previous.persons[id]
      persons[id] = {
        ...person,
        updatedAt: now,
        ...(person.photo !== previousPerson?.photo
          ? { photoUpdatedAt: person.photo ? now : undefined }
          : {}),
      }
      markDirty("persons", id, "upsert", previousPerson?.revision, operationId)
    }
    for (const id of Object.keys(previous.persons)) {
      if (!next.persons[id]) {
        markDirty(
          "persons",
          id,
          "delete",
          previous.persons[id]?.revision,
          operationId,
        )
      }
    }
  }

  let index = next.index
  if (previous.index !== next.index) {
    const previousById = new Map(
      previous.index.map((tree) => [tree.id, tree] as const),
    )
    let cloned = false
    for (let position = 0; position < next.index.length; position++) {
      const tree = next.index[position]
      if (!tree || tree === previousById.get(tree.id)) continue
      if (!cloned) {
        index = [...next.index]
        cloned = true
      }
      index[position] = { ...tree, updatedAt: now }
      markDirty(
        "trees",
        tree.id,
        "upsert",
        previousById.get(tree.id)?.revision,
        operationId,
      )
    }
    const nextIds = new Set(next.index.map((tree) => tree.id))
    for (const tree of previous.index) {
      if (!nextIds.has(tree.id)) {
        markDirty("trees", tree.id, "delete", tree.revision, operationId)
      }
    }
  }

  return {
    ...next,
    persons,
    index,
    treeMembers: stampRecordMap(
      previous.treeMembers,
      next.treeMembers,
      "treeMembers",
      now,
      operationId,
    ),
    unions: stampRecordMap(
      previous.unions,
      next.unions,
      "unions",
      now,
      operationId,
    ),
    unionEvents: stampRecordMap(
      previous.unionEvents,
      next.unionEvents,
      "unionEvents",
      now,
      operationId,
    ),
    treeUnions: stampRecordMap(
      previous.treeUnions,
      next.treeUnions,
      "treeUnions",
      now,
      operationId,
    ),
    parentChildRelationships: stampRecordMap(
      previous.parentChildRelationships,
      next.parentChildRelationships,
      "parentChildRelationships",
      now,
      operationId,
      false,
    ),
    treeParentChildRelationships: stampRecordMap(
      previous.treeParentChildRelationships,
      next.treeParentChildRelationships,
      "treeParentChildRelationships",
      now,
      operationId,
    ),
  }
}

export function snapshotDirty(): DirtyState {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map(dirtyState[collection]),
    ]),
  ) as DirtyState
}

export function clearDirty(ids: DirtyIds, shipped?: DirtyState): void {
  for (const collection of RECORD_COLLECTIONS) {
    for (const id of ids[collection] ?? []) {
      const current = dirtyState[collection].get(id)
      const sent = shipped?.[collection].get(id)
      if (!shipped || (current && sent && current.revision === sent.revision)) {
        if (current) {
          const token = dirtyToken(collection, id, current)
          if (token) clearedDirtyTokens.add(token)
        }
        dirtyState[collection].delete(id)
      }
    }
  }
  schedulePersistence()
}
