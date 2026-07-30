import type { DirtyCollection, DirtyRecord, GlobalState } from "./state"

const DATABASE_NAME = "family-tree-sync-v2"
const STORE_NAME = "accounts"

export type PersistedConflict = {
  conflictId: string
  collection: DirtyCollection
  id: string
  record: DirtyRecord
  value: unknown
}

export type PersistedOperationConflict = {
  operationId: string
  reason: string
  retryable: boolean
  records: Array<{
    collection: DirtyCollection
    id: string
    dirty: DirtyRecord
    deviceValue: unknown
    serverValue: unknown
  }>
}

export type PersistedStore = {
  state: GlobalState
  dirty: Record<DirtyCollection, Array<[string, DirtyRecord]>>
  deviceId: string
  mutationIdsByBatch: Array<[string, string]>
  nextRevision: number
  clearedDirtyTokens?: string[]
  conflicts?: PersistedConflict[]
  clearedConflictIds?: string[]
  operationConflicts?: PersistedOperationConflict[]
  clearedOperationConflictIds?: string[]
}

const COLLECTIONS: DirtyCollection[] = [
  "persons",
  "trees",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
]

function tokenFor(
  collection: DirtyCollection,
  id: string,
  record: DirtyRecord,
): string | undefined {
  return record.sourceId
    ? JSON.stringify([collection, id, record.sourceId, record.revision])
    : undefined
}

function copyRecord(
  target: GlobalState,
  source: GlobalState,
  collection: DirtyCollection,
  id: string,
  action: DirtyRecord["action"],
): void {
  if (collection === "trees") {
    target.index = target.index.filter((tree) => tree.id !== id)
    if (action === "upsert") {
      const tree = source.index.find((candidate) => candidate.id === id)
      if (tree) target.index.push(tree)
    }
    return
  }
  const key = collection === "persons" ? "persons" : collection
  const targetRecords = target[key]
  const sourceRecords = source[key]
  if (action === "delete") delete targetRecords[id]
  else if (sourceRecords[id]) targetRecords[id] = sourceRecords[id]
}

function recordValue(
  state: GlobalState,
  collection: DirtyCollection,
  id: string,
): unknown {
  if (collection === "trees") {
    return state.index.find((tree) => tree.id === id)
  }
  const key = collection === "persons" ? "persons" : collection
  return state[key][id]
}

function mergePersistedStore(
  existing: PersistedStore | undefined,
  incoming: PersistedStore,
): PersistedStore {
  if (!existing) return incoming
  const merged = structuredClone(incoming)
  const cleared = new Set(incoming.clearedDirtyTokens ?? [])
  const clearedConflictIds = new Set(incoming.clearedConflictIds ?? [])
  const clearedOperationConflictIds = new Set(
    incoming.clearedOperationConflictIds ?? [],
  )
  merged.conflicts = [
    ...new Map(
      [...(existing.conflicts ?? []), ...(incoming.conflicts ?? [])]
        .filter((conflict) => !clearedConflictIds.has(conflict.conflictId))
        .map((conflict) => [conflict.conflictId, conflict]),
    ).values(),
  ]
  merged.operationConflicts = [
    ...new Map(
      [
        ...(existing.operationConflicts ?? []),
        ...(incoming.operationConflicts ?? []),
      ]
        .filter(
          (conflict) => !clearedOperationConflictIds.has(conflict.operationId),
        )
        .map((conflict) => [conflict.operationId, conflict]),
    ).values(),
  ]

  for (const collection of COLLECTIONS) {
    const incomingDirty = new Map(merged.dirty[collection] ?? [])
    for (const [id, record] of existing.dirty[collection] ?? []) {
      const token = tokenFor(collection, id, record)
      if (token && cleared.has(token)) continue
      const candidate = incomingDirty.get(id)
      const existingOrder = record.changedAt ?? record.revision
      const incomingOrder = candidate?.changedAt ?? candidate?.revision ?? -1
      if (
        candidate?.sourceId
        && record.sourceId
        && candidate.sourceId !== record.sourceId
      ) {
        incomingDirty.set(id, { ...candidate, blocked: true })
        const conflictId = JSON.stringify([
          collection,
          id,
          record.sourceId,
          record.revision,
        ])
        if (
          !merged.conflicts.some(
            (conflict) => conflict.conflictId === conflictId,
          )
        ) {
          merged.conflicts.push({
            conflictId,
            collection,
            id,
            record,
            value: recordValue(existing.state, collection, id),
          })
        }
        continue
      }
      if (!candidate || existingOrder > incomingOrder) {
        incomingDirty.set(id, record)
        copyRecord(merged.state, existing.state, collection, id, record.action)
      }
    }
    merged.dirty[collection] = [...incomingDirty]
  }
  merged.mutationIdsByBatch = [
    ...new Map([
      ...existing.mutationIdsByBatch,
      ...incoming.mutationIdsByBatch,
    ]),
  ]
  merged.nextRevision = Math.max(existing.nextRevision, incoming.nextRevision)
  merged.clearedDirtyTokens = [
    ...new Set([
      ...(existing.clearedDirtyTokens ?? []),
      ...(incoming.clearedDirtyTokens ?? []),
    ]),
  ]
  merged.clearedConflictIds = [
    ...new Set([
      ...(existing.clearedConflictIds ?? []),
      ...(incoming.clearedConflictIds ?? []),
    ]),
  ]
  merged.clearedOperationConflictIds = [
    ...new Set([
      ...(existing.clearedOperationConflictIds ?? []),
      ...(incoming.clearedOperationConflictIds ?? []),
    ]),
  ]
  return merged
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadPersistedStore(
  userId: string,
): Promise<PersistedStore | null> {
  const database = await openDatabase()
  if (!database) return null
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const request = transaction.objectStore(STORE_NAME).get(userId)
    request.onsuccess = () =>
      resolve((request.result as PersistedStore | undefined) ?? null)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
  })
}

export async function savePersistedStore(
  userId: string,
  value: PersistedStore,
): Promise<PersistedStore | null> {
  const database = await openDatabase()
  if (!database) return null
  const saved = await new Promise<PersistedStore>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(userId)
    let merged = value
    request.onsuccess = () => {
      merged = mergePersistedStore(
        request.result as PersistedStore | undefined,
        value,
      )
      store.put(merged, userId)
    }
    transaction.oncomplete = () => resolve(merged)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
  return saved
}
