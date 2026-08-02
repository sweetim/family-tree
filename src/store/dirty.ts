/**
 * Per-record dirty tracking. These functions mutate the engine singletons
 * (`dirtyState`, `clearedDirtyTokens`, `pendingMutation`) imported as live
 * bindings from `state.ts`; reads and in-place mutation work directly, while
 * the `nextRevision` counter is bumped through `bumpRevision()` because
 * imported bindings cannot be reassigned.
 */

import {
  bumpRevision,
  clearedDirtyTokens,
  type DirtyAction,
  type DirtyCollection,
  type DirtyIds,
  type DirtyRecord,
  type DirtyState,
  dirtyState,
  type GlobalState,
  pendingMutation,
  schedulePersistence,
  storeInstanceId,
} from "./state"
import {
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_BATCH_RECORDS,
  MAX_SYNC_RECORDS_PER_COLLECTION,
  newId,
  RECORD_COLLECTIONS,
} from "./state-internals"

export function markDirty(
  collection: DirtyCollection,
  id: string,
  action: DirtyAction,
  baseRevision?: number,
  operationId?: string,
): void {
  const current = dirtyState[collection].get(id)
  const isPending = Boolean(
    pendingMutation?.dirty[collection].some(
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
      persons[id] = { ...person, updatedAt: now }
      markDirty(
        "persons",
        id,
        "upsert",
        previous.persons[id]?.revision,
        operationId,
      )
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
