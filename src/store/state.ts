import { useSyncExternalStore } from "react"
import type {
  ParentChildRelationshipWire,
  PersonPushWire,
  PersonWire,
  SyncChangePage,
  LocalRole as SyncLocalRole,
  SyncMutationResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncRecordSet,
  ShareRole as SyncShareRole,
  TreeManifestItem,
  TreeManifestResponse,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreePushWire,
  TreeSnapshotResponse,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "../sync/types"
import type { NormalizedRelationships, PersonIdentity } from "../types"
import {
  loadPersistedStore,
  type PersistedConflict,
  type PersistedOperationConflict,
  type PersistedStore,
  savePersistedStore,
} from "./persistence"

export type ShareRole = SyncShareRole
export type LocalRole = SyncLocalRole

export type TreeMeta = {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  revision?: number
  syncVersion?: number
  memberCount?: number
  loaded?: boolean
  cursor?: string
  ownerId?: string
  ownerEmail?: string | null
  role?: LocalRole
}

export type GlobalState = NormalizedRelationships & {
  persons: Record<string, PersonIdentity>
  index: TreeMeta[]
}

export type SyncStatus = "saved" | "saving" | "offline" | "conflict"

const RECORD_COLLECTIONS = [
  "persons",
  "trees",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const

export type DirtyCollection = (typeof RECORD_COLLECTIONS)[number]
export type DirtyAction = "upsert" | "delete"
export type DirtyRecord = {
  action: DirtyAction
  revision: number
  baseRevision?: number
  blocked?: boolean
  operationId?: string
  sourceId?: string
  changedAt?: number
}
export type DirtyMap = Map<string, DirtyRecord>
export type DirtyState = Record<DirtyCollection, DirtyMap>
export type BlockedChange = {
  id: string
  action: DirtyAction
  label: string
  reason: string
  retryable: boolean
  device: Array<{ label: string; value: string }>
  server: Array<{ label: string; value: string }>
}
type TombstoneClock = { updatedAt: string; revision?: number }
type TombstoneClocks = Record<DirtyCollection, Map<string, TombstoneClock>>

const EPOCH = "1970-01-01T00:00:00.000Z"
const STORED_PHOTO_MARKER = "stored-photo"
const MAX_SYNC_BATCH_RECORDS = 5_000
const MAX_SYNC_RECORDS_PER_COLLECTION = 2_000
const MAX_SYNC_BATCH_BYTES = 4 * 1024 * 1024

export function isStoredPhotoMarker(value: string | undefined): boolean {
  return value === STORED_PHOTO_MARKER
}

export function newId(): string {
  return crypto.randomUUID()
}

export function treeMemberKey(treeId: string, personId: string): string {
  return JSON.stringify([treeId, personId])
}

export function treeUnionKey(treeId: string, unionId: string): string {
  return JSON.stringify([treeId, unionId])
}

export function treeParentChildRelationshipKey(
  treeId: string,
  parentChildRelationshipId: string,
): string {
  return JSON.stringify([treeId, parentChildRelationshipId])
}

function parseAssociationKey(key: string): [string, string] {
  const parsed = JSON.parse(key) as unknown
  if (
    !Array.isArray(parsed)
    || typeof parsed[0] !== "string"
    || typeof parsed[1] !== "string"
  ) {
    throw new Error(`Invalid association key: ${key}`)
  }
  return [parsed[0], parsed[1]]
}

function emptyState(): GlobalState {
  return {
    persons: {},
    index: [],
    treeMembers: {},
    unions: {},
    unionEvents: {},
    treeUnions: {},
    parentChildRelationships: {},
    treeParentChildRelationships: {},
  }
}

function emptyDirtyState(): DirtyState {
  return {
    persons: new Map(),
    trees: new Map(),
    treeMembers: new Map(),
    unions: new Map(),
    unionEvents: new Map(),
    treeUnions: new Map(),
    parentChildRelationships: new Map(),
    treeParentChildRelationships: new Map(),
  }
}

function emptyTombstoneClocks(): TombstoneClocks {
  return {
    persons: new Map(),
    trees: new Map(),
    treeMembers: new Map(),
    unions: new Map(),
    unionEvents: new Map(),
    treeUnions: new Map(),
    parentChildRelationships: new Map(),
    treeParentChildRelationships: new Map(),
  }
}

// ---------------------------------------------------------------------------
// Per-record dirty tracking and normalized sync.
// ---------------------------------------------------------------------------

let state = emptyState()
let dirtyState = emptyDirtyState()
let remoteTombstoneClocks = emptyTombstoneClocks()
let nextRevision = 1
let storeGeneration = 0
let pushInFlight: Promise<void> | undefined
let pushInFlightGeneration = -1
const treeSyncInFlight = new Map<string, Promise<void>>()
let deviceId = newId()
const storeInstanceId = newId()
const mutationIdsByBatch = new Map<string, string>()
const clearedDirtyTokens = new Set<string>()
let syncConflicts: PersistedConflict[] = []
let operationConflicts: PersistedOperationConflict[] = []
const clearedConflictIds = new Set<string>()
let persistenceUserId: string | null = null
let persistenceScheduled = false
let persistenceWrite = Promise.resolve()
let persistenceRestore: Promise<void> | undefined
let persistenceRestoreUserId: string | null = null
let persistenceRestoreToken = 0

/**
 * Display-only hint mapping a person to the id of their earliest ancestor-family
 * tree. Populated from tree snapshots so the "ancestor family" card label can
 * render before every related tree is loaded. Not synced and not part of the
 * normalized graph — `projectTree` never reads it, so it cannot leak partial
 * membership into a tree's projection.
 */
let ancestorTreeLinks = new Map<string, string>()

function persistedSnapshot(): PersistedStore {
  return {
    state,
    dirty: Object.fromEntries(
      RECORD_COLLECTIONS.map((collection) => [
        collection,
        [...dirtyState[collection]],
      ]),
    ) as PersistedStore["dirty"],
    deviceId,
    mutationIdsByBatch: [...mutationIdsByBatch],
    nextRevision,
    clearedDirtyTokens: [...clearedDirtyTokens],
    conflicts: syncConflicts,
    clearedConflictIds: [...clearedConflictIds],
    operationConflicts,
  }
}

function persistCurrentStore(): Promise<void> {
  const userId = persistenceUserId
  if (!userId) return Promise.resolve()
  const snapshot = persistedSnapshot()
  persistenceWrite = persistenceWrite
    .catch(() => undefined)
    .then(async () => {
      const persisted = await savePersistedStore(userId, snapshot)
      if (!persisted || persistenceUserId !== userId) return
      syncConflicts = persisted.conflicts ?? []
      operationConflicts = persisted.operationConflicts ?? []
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

function schedulePersistence(): void {
  if (!persistenceUserId || persistenceScheduled) return
  persistenceScheduled = true
  queueMicrotask(() => {
    persistenceScheduled = false
    void persistCurrentStore().catch((error) =>
      console.error("failed to persist sync outbox", error),
    )
  })
}

function markDirty(
  collection: DirtyCollection,
  id: string,
  action: DirtyAction,
  baseRevision?: number,
  operationId?: string,
): void {
  dirtyState[collection].set(id, {
    action,
    revision: nextRevision++,
    baseRevision: dirtyState[collection].get(id)?.blocked
      ? baseRevision
      : (dirtyState[collection].get(id)?.baseRevision ?? baseRevision),
    operationId,
    sourceId: storeInstanceId,
    changedAt: Date.now(),
  })
}

function dirtyToken(
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
      markDirty(collection, id, "delete", previous[id]?.revision, operationId)
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

type UpdateOptions = { remote?: boolean }

const listeners = new Set<() => void>()
let hydrated = false
let notificationsSuppressed = false
let syncStatus: SyncStatus = "saved"
let blockedChangesVersion = 0
const blockedChangesCache = new Map<
  string,
  { version: number; changes: BlockedChange[] }
>()

function notifyListeners(): void {
  blockedChangesVersion++
  blockedChangesCache.clear()
  for (const listener of listeners) listener()
}

function setSyncStatus(value: SyncStatus): void {
  if (syncStatus === value) return
  syncStatus = value
  notifyListeners()
}

function statusFromDirtyState(): SyncStatus {
  if (
    RECORD_COLLECTIONS.some((collection) =>
      [...dirtyState[collection].values()].some((record) => record.blocked),
    )
  ) {
    return "conflict"
  }
  return RECORD_COLLECTIONS.some(
    (collection) => dirtyState[collection].size > 0,
  )
    ? "saving"
    : "saved"
}

export function update(
  updater: (previous: GlobalState) => GlobalState,
  options?: UpdateOptions,
): void {
  const previous = state
  const next = updater(previous)
  if (next === previous) return
  state = options?.remote ? next : stampAndEnqueue(previous, next)
  if (!notificationsSuppressed) {
    notifyListeners()
  }
  schedulePersistence()
  if (!options?.remote) setSyncStatus("saving")
  if (!options?.remote) void pushDirty()
}

export function getSnapshot(): GlobalState {
  return state
}

export function snapshotDirty(): DirtyState {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map(dirtyState[collection]),
    ]),
  ) as DirtyState
}

export function blockedChangesForTree(
  currentState: GlobalState,
  currentDirtyState: DirtyState,
  treeId: string,
): BlockedChange[] {
  const operations = new Map<
    string,
    { action: DirtyAction; labels: Set<string> }
  >()
  const personName = (personId: string): string | undefined =>
    currentState.persons[personId]?.name

  for (const collection of RECORD_COLLECTIONS) {
    for (const [id, record] of currentDirtyState[collection]) {
      if (!record.blocked) continue
      if (
        (collection === "treeMembers"
          || collection === "treeUnions"
          || collection === "treeParentChildRelationships")
        && parseAssociationKey(id)[0] !== treeId
      ) {
        continue
      }

      const operationId = record.operationId ?? `${collection}:${id}`
      const operation = operations.get(operationId) ?? {
        action: record.action,
        labels: new Set<string>(),
      }
      operations.set(operationId, operation)

      if (collection === "persons") {
        const name = personName(id)
        if (name) operation.labels.add(name)
      } else if (collection === "trees") {
        const tree = currentState.index.find((item) => item.id === id)
        if (tree?.name) operation.labels.add(tree.name)
      } else if (collection === "treeMembers") {
        const name = personName(parseAssociationKey(id)[1])
        if (name) operation.labels.add(name)
      } else if (collection === "parentChildRelationships") {
        const relationship = currentState.parentChildRelationships[id]
        const parent = relationship
          ? personName(relationship.parentPersonId)
          : undefined
        const child = relationship
          ? personName(relationship.childPersonId)
          : undefined
        if (parent && child) operation.labels.add(`${parent} and ${child}`)
      } else if (collection === "unions") {
        const union = currentState.unions[id]
        const first = union ? personName(union.firstPersonId) : undefined
        const second = union ? personName(union.secondPersonId) : undefined
        if (first && second) operation.labels.add(`${first} and ${second}`)
      }
    }
  }

  return [...operations].map(([id, operation]) => {
    const subject = [...operation.labels].slice(0, 2).join(", ")
    const label = subject
      ? operation.action === "delete"
        ? `Remove ${subject}`
        : `Update ${subject}`
      : operation.action === "delete"
        ? "Remove family connection"
        : "Update family details"
    return {
      id,
      action: operation.action,
      label,
      reason: "This change conflicts with a newer server version.",
      retryable: true,
      device: [],
      server: [],
    }
  })
}

function valueFor(
  currentState: GlobalState,
  collection: DirtyCollection,
  id: string,
): unknown {
  return collection === "trees"
    ? currentState.index.find((tree) => tree.id === id)
    : currentState[collection][id]
}

function wireId(
  collection: DirtyCollection,
  wire: Record<string, string>,
): string {
  if (collection === "treeMembers") {
    return treeMemberKey(wire.treeId ?? "", wire.personId ?? "")
  }
  if (collection === "treeUnions") {
    return treeUnionKey(wire.treeId ?? "", wire.unionId ?? "")
  }
  if (collection === "treeParentChildRelationships") {
    return treeParentChildRelationshipKey(
      wire.treeId ?? "",
      wire.parentChildRelationshipId ?? "",
    )
  }
  return wire.id ?? ""
}

function recordSetValue(
  records: SyncRecordSet,
  collection: DirtyCollection,
  id: string,
): unknown {
  return records[collection].find(
    (wire) =>
      wireId(collection, wire as unknown as Record<string, string>) === id,
  )
}

function snapshotOperationConflict(
  source: DirtyState,
  operationId: string | undefined,
  result: SyncMutationResponse,
): void {
  const id = operationId ?? "legacy-operation"
  if (operationConflicts.some((conflict) => conflict.operationId === id)) return
  const records = RECORD_COLLECTIONS.flatMap((collection) =>
    [...source[collection]]
      .filter(([, dirty]) => dirty.operationId === operationId)
      .map(([recordId, dirty]) => ({
        collection,
        id: recordId,
        dirty: structuredClone(dirty),
        deviceValue: structuredClone(valueFor(state, collection, recordId)),
        serverValue: structuredClone(
          result.conflict
            ? recordSetValue(result.conflict.records, collection, recordId)
            : undefined,
        ),
      })),
  )
  operationConflicts.push({
    operationId: id,
    reason: result.conflict?.reason ?? "revision-mismatch",
    retryable: result.conflict?.retryable ?? false,
    records,
  })
}

export function takeDirtyBatch(
  source: DirtyState,
  maximumRecords: number,
): DirtyState {
  const batch = emptyDirtyState()
  const targetOperationId = RECORD_COLLECTIONS.flatMap((collection) => [
    ...source[collection].values(),
  ]).find((record) => !record.blocked)?.operationId
  let remaining = maximumRecords
  for (const collection of RECORD_COLLECTIONS) {
    if (remaining === 0) break
    for (const [id, record] of source[collection]) {
      if (record.blocked) continue
      if (record.operationId !== targetOperationId) continue
      batch[collection].set(id, record)
      remaining--
      if (remaining === 0) break
    }
  }
  return batch
}

type DirtyIds = Partial<Record<DirtyCollection, Iterable<string>>>

/** Clear acknowledgements only when the shipped revision is still current. */
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

function acknowledgeApplied(
  result: SyncPushResponse,
  shipped: DirtyState,
): void {
  const acknowledgedRevisions = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map<string, number>(),
    ]),
  ) as Record<DirtyCollection, Map<string, number>>

  for (const collection of RECORD_COLLECTIONS) {
    for (const id of result.applied[collection]) {
      const sent = shipped[collection].get(id)
      if (!sent) continue
      const revision = (sent.baseRevision ?? 0) + 1
      acknowledgedRevisions[collection].set(id, revision)
      const pending = dirtyState[collection].get(id)
      if (pending && pending.revision !== sent.revision) {
        dirtyState[collection].set(id, { ...pending, baseRevision: revision })
      }
    }
  }

  update(
    (previous) => {
      let persons = previous.persons
      for (const [id, revision] of acknowledgedRevisions.persons) {
        const person = persons[id]
        if (!person) continue
        if (persons === previous.persons) persons = { ...persons }
        persons[id] = { ...person, revision, updatedAt: result.serverTime }
      }

      let index = previous.index
      for (const [id, revision] of acknowledgedRevisions.trees) {
        const position = index.findIndex((tree) => tree.id === id)
        if (position < 0) continue
        if (index === previous.index) index = [...index]
        const tree = index[position]
        if (tree) {
          index[position] = { ...tree, revision, updatedAt: result.serverTime }
        }
      }

      const stampCollection = <
        T extends { revision?: number; updatedAt: string },
      >(
        records: Record<string, T>,
        collection: Exclude<DirtyCollection, "persons" | "trees">,
      ): Record<string, T> => {
        let next = records
        for (const [id, revision] of acknowledgedRevisions[collection]) {
          const record = next[id]
          if (!record) continue
          if (next === records) next = { ...records }
          next[id] = { ...record, revision, updatedAt: result.serverTime }
        }
        return next
      }

      return {
        ...previous,
        persons,
        index,
        treeMembers: stampCollection(previous.treeMembers, "treeMembers"),
        unions: stampCollection(previous.unions, "unions"),
        unionEvents: stampCollection(previous.unionEvents, "unionEvents"),
        treeUnions: stampCollection(previous.treeUnions, "treeUnions"),
        parentChildRelationships: stampCollection(
          previous.parentChildRelationships,
          "parentChildRelationships",
        ),
        treeParentChildRelationships: stampCollection(
          previous.treeParentChildRelationships,
          "treeParentChildRelationships",
        ),
      }
    },
    { remote: true },
  )
}

function applyAliases(result: SyncPushResponse): void {
  const aliases = result.aliases?.parentChildRelationships
  if (!aliases || Object.keys(aliases).length === 0) return

  update(
    (previous) => {
      const parentChildRelationships = { ...previous.parentChildRelationships }
      const treeParentChildRelationships = {
        ...previous.treeParentChildRelationships,
      }
      for (const [clientId, canonical] of Object.entries(aliases)) {
        const local = parentChildRelationships[clientId]
        if (local) {
          delete parentChildRelationships[clientId]
          parentChildRelationships[canonical.id] = {
            ...local,
            id: canonical.id,
            revision: canonical.revision,
            type: canonical.type,
            updatedAt: result.serverTime,
          }
        }
        const dirtyFact = dirtyState.parentChildRelationships.get(clientId)
        if (dirtyFact) {
          dirtyState.parentChildRelationships.delete(clientId)
          dirtyState.parentChildRelationships.set(canonical.id, {
            ...dirtyFact,
            baseRevision: canonical.revision,
          })
        }
        for (const [key, association] of Object.entries(
          treeParentChildRelationships,
        )) {
          if (association.parentChildRelationshipId !== clientId) continue
          delete treeParentChildRelationships[key]
          const canonicalKey = treeParentChildRelationshipKey(
            association.treeId,
            canonical.id,
          )
          treeParentChildRelationships[canonicalKey] = {
            ...association,
            parentChildRelationshipId: canonical.id,
            revision:
              result.aliases?.treeParentChildRelationships?.[key]?.revision
              ?? association.revision,
            updatedAt: result.serverTime,
          }
          const dirtyAssociation =
            dirtyState.treeParentChildRelationships.get(key)
          if (dirtyAssociation) {
            dirtyState.treeParentChildRelationships.delete(key)
            dirtyState.treeParentChildRelationships.set(
              canonicalKey,
              dirtyAssociation,
            )
          }
        }
      }
      return {
        ...previous,
        parentChildRelationships,
        treeParentChildRelationships,
      }
    },
    { remote: true },
  )
}

function actionFor(dirty: DirtyMap, id: string): DirtyAction | undefined {
  return dirty.get(id)?.action
}

export function buildPushWires(
  snapshot: GlobalState,
  dirty: DirtyState,
  now: string,
): SyncPushRequest {
  const persons: PersonPushWire[] = []
  for (const id of dirty.persons.keys()) {
    const person = snapshot.persons[id]
    if (actionFor(dirty.persons, id) === "delete" || !person) {
      persons.push({
        id,
        revision: dirty.persons.get(id)?.baseRevision,
        updatedAt: now,
        deletedAt: now,
      })
    } else {
      persons.push({
        id,
        name: person.name,
        dob: person.dob,
        dod: person.dod,
        gender: person.gender,
        birthplace: person.birthplace,
        revision: person.revision,
        ...(isStoredPhotoMarker(person.photo)
          ? {}
          : { photo: person.photo ?? null }),
        updatedAt: person.updatedAt ?? now,
      })
    }
  }

  const trees: TreePushWire[] = []
  for (const id of dirty.trees.keys()) {
    const tree = snapshot.index.find((candidate) => candidate.id === id)
    if (actionFor(dirty.trees, id) === "delete" || !tree) {
      trees.push({
        id,
        revision: dirty.trees.get(id)?.baseRevision,
        updatedAt: now,
        deletedAt: now,
      })
    } else {
      trees.push({
        id,
        name: tree.name,
        createdAt: tree.createdAt,
        revision: tree.revision,
        updatedAt: tree.updatedAt ?? now,
      })
    }
  }

  const treeMembers: TreeMemberWire[] = []
  for (const id of dirty.treeMembers.keys()) {
    const record = snapshot.treeMembers[id]
    if (actionFor(dirty.treeMembers, id) === "delete" || !record) {
      const [treeId, personId] = parseAssociationKey(id)
      treeMembers.push({
        treeId,
        personId,
        revision: dirty.treeMembers.get(id)?.baseRevision,
        updatedAt: now,
        deletedAt: now,
      })
    } else treeMembers.push(record)
  }

  const unions: UnionWire[] = []
  for (const id of dirty.unions.keys()) {
    const record = snapshot.unions[id]
    unions.push(
      actionFor(dirty.unions, id) === "delete" || !record
        ? {
            id,
            revision: dirty.unions.get(id)?.baseRevision,
            updatedAt: now,
            deletedAt: now,
          }
        : record,
    )
  }

  const unionEvents: UnionEventWire[] = []
  for (const id of dirty.unionEvents.keys()) {
    const record = snapshot.unionEvents[id]
    unionEvents.push(
      actionFor(dirty.unionEvents, id) === "delete" || !record
        ? {
            id,
            revision: dirty.unionEvents.get(id)?.baseRevision,
            updatedAt: now,
            deletedAt: now,
          }
        : record,
    )
  }

  const treeUnions: TreeUnionWire[] = []
  for (const id of dirty.treeUnions.keys()) {
    const record = snapshot.treeUnions[id]
    if (actionFor(dirty.treeUnions, id) === "delete" || !record) {
      const [treeId, unionId] = parseAssociationKey(id)
      treeUnions.push({
        treeId,
        unionId,
        revision: dirty.treeUnions.get(id)?.baseRevision,
        updatedAt: now,
        deletedAt: now,
      })
    } else treeUnions.push(record)
  }

  const parentChildRelationships: ParentChildRelationshipWire[] = []
  for (const id of dirty.parentChildRelationships.keys()) {
    const record = snapshot.parentChildRelationships[id]
    parentChildRelationships.push(
      actionFor(dirty.parentChildRelationships, id) === "delete" || !record
        ? {
            id,
            revision: dirty.parentChildRelationships.get(id)?.baseRevision,
            updatedAt: now,
            deletedAt: now,
          }
        : record,
    )
  }

  const treeParentChildRelationships: TreeParentChildRelationshipWire[] = []
  for (const id of dirty.treeParentChildRelationships.keys()) {
    const record = snapshot.treeParentChildRelationships[id]
    if (
      actionFor(dirty.treeParentChildRelationships, id) === "delete"
      || !record
    ) {
      const [treeId, parentChildRelationshipId] = parseAssociationKey(id)
      treeParentChildRelationships.push({
        treeId,
        parentChildRelationshipId,
        revision: dirty.treeParentChildRelationships.get(id)?.baseRevision,
        updatedAt: now,
        deletedAt: now,
      })
    } else treeParentChildRelationships.push(record)
  }

  return {
    persons,
    trees,
    treeMembers,
    unions,
    unionEvents,
    treeUnions,
    parentChildRelationships,
    treeParentChildRelationships,
  }
}

function hasNewerDirtyRecords(shipped: DirtyState): boolean {
  return RECORD_COLLECTIONS.some((collection) =>
    [...dirtyState[collection]].some(([id, current]) => {
      const sent = shipped[collection].get(id)
      return !sent || sent.revision !== current.revision
    }),
  )
}

function hasAcknowledgedIds(
  ids: Partial<SyncPushResponse["skipped"]>,
): boolean {
  return RECORD_COLLECTIONS.some(
    (collection) => (ids[collection]?.length ?? 0) > 0,
  )
}

function dirtyBatchKey(dirty: DirtyState): string {
  return JSON.stringify(
    RECORD_COLLECTIONS.flatMap((collection) =>
      [...dirty[collection]].map(([id, record]) => [
        collection,
        id,
        record.revision,
      ]),
    ),
  )
}

function firstPendingOperation(source: DirtyState): string | undefined {
  return RECORD_COLLECTIONS.flatMap((collection) => [
    ...source[collection].values(),
  ]).find((record) => !record.blocked)?.operationId
}

function operationExceedsRecordLimits(
  source: DirtyState,
  operationId: string | undefined,
): boolean {
  let total = 0
  for (const collection of RECORD_COLLECTIONS) {
    const count = [...source[collection].values()].filter(
      (record) => !record.blocked && record.operationId === operationId,
    ).length
    if (count > MAX_SYNC_RECORDS_PER_COLLECTION) return true
    total += count
  }
  return total > MAX_SYNC_BATCH_RECORDS
}

function blockOperation(
  source: DirtyState,
  operationId: string | undefined,
): void {
  for (const collection of RECORD_COLLECTIONS) {
    for (const [id, sent] of source[collection]) {
      if (sent.operationId !== operationId) continue
      const current = dirtyState[collection].get(id)
      if (current?.revision === sent.revision) {
        dirtyState[collection].set(id, { ...current, blocked: true })
      }
    }
  }
  schedulePersistence()
  setSyncStatus("conflict")
}

export async function fetchFullPull(): Promise<SyncPullResponse> {
  const response = await fetch(`/api/sync?since=${encodeURIComponent(EPOCH)}`, {
    credentials: "include",
  })
  if (!response.ok) throw new Error(`pull failed: ${response.status}`)
  return (await response.json()) as SyncPullResponse
}

export async function fetchTreeManifest(): Promise<TreeManifestItem[]> {
  const trees: TreeManifestItem[] = []
  let cursor: string | undefined
  do {
    const parameters = new URLSearchParams({ limit: "100" })
    if (cursor) parameters.set("cursor", cursor)
    const response = await fetch(`/api/trees?${parameters}`, {
      credentials: "include",
    })
    if (!response.ok)
      throw new Error(`tree manifest failed: ${response.status}`)
    const page = (await response.json()) as TreeManifestResponse
    trees.push(...page.trees)
    cursor = page.nextCursor
  } while (cursor)
  return trees
}

export function applyTreeManifest(manifest: TreeManifestItem[]): void {
  const remoteIds = new Set(manifest.map((tree) => tree.id))
  const pendingTreeIds = new Set(dirtyState.trees.keys())
  update(
    (previous) => {
      const localById = new Map(previous.index.map((tree) => [tree.id, tree]))
      return {
        ...previous,
        index: [
          ...manifest.map((tree) => {
            const local = localById.get(tree.id)
            const pending = dirtyState.trees.get(tree.id)
            return {
              ...local,
              ...tree,
              ...(pending?.action === "upsert" && local
                ? { name: local.name }
                : {}),
              loaded: local?.loaded,
              cursor: local?.cursor,
            }
          }),
          ...previous.index.filter(
            (tree) => !remoteIds.has(tree.id) && pendingTreeIds.has(tree.id),
          ),
        ],
      }
    },
    { remote: true },
  )
}

export async function fetchTreeSnapshot(
  treeId: string,
  focusPersonId?: string,
): Promise<TreeSnapshotResponse> {
  const path = focusPersonId
    ? `/api/trees/${encodeURIComponent(treeId)}/graph?focusPersonId=${encodeURIComponent(focusPersonId)}&radius=3`
    : `/api/trees/${encodeURIComponent(treeId)}/snapshot`
  const response = await fetch(path, { credentials: "include" })
  if (!response.ok) {
    throw Object.assign(new Error(`tree snapshot failed: ${response.status}`), {
      status: response.status,
    })
  }
  return (await response.json()) as TreeSnapshotResponse
}

export async function deleteTreeOnServer(treeId: string): Promise<void> {
  const generation = storeGeneration
  const tree = state.index.find((candidate) => candidate.id === treeId)
  if (!tree?.revision) throw new Error("tree is not synchronized")
  const timestamp = new Date().toISOString()
  const retryKey = `tree-delete:${treeId}:${tree.revision}`
  const mutationId = mutationIdsByBatch.get(retryKey) ?? newId()
  mutationIdsByBatch.set(retryKey, mutationId)
  await persistCurrentStore()
  const records: SyncPushRequest = {
    persons: [],
    trees: [
      {
        id: treeId,
        revision: tree.revision,
        updatedAt: timestamp,
        deletedAt: timestamp,
      },
    ],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
  const response = await fetch("/api/mutations", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 2,
      deviceId,
      mutationId,
      records,
    }),
  })
  if (generation !== storeGeneration) {
    throw new Error("account changed during tree deletion")
  }
  if (!response.ok) throw new Error(`delete failed: ${response.status}`)
  mutationIdsByBatch.delete(retryKey)
  schedulePersistence()
}

export function applyTreeSnapshot(snapshot: TreeSnapshotResponse): void {
  if (!snapshot.partial) {
    update(
      (previous) => ({
        ...previous,
        treeMembers: Object.fromEntries(
          Object.entries(previous.treeMembers).filter(
            ([key, record]) =>
              record.treeId !== snapshot.tree.id
              || dirtyState.treeMembers.has(key),
          ),
        ),
        treeUnions: Object.fromEntries(
          Object.entries(previous.treeUnions).filter(
            ([key, record]) =>
              record.treeId !== snapshot.tree.id
              || dirtyState.treeUnions.has(key),
          ),
        ),
        treeParentChildRelationships: Object.fromEntries(
          Object.entries(previous.treeParentChildRelationships).filter(
            ([key, record]) =>
              record.treeId !== snapshot.tree.id
              || dirtyState.treeParentChildRelationships.has(key),
          ),
        ),
      }),
      { remote: true },
    )
  }
  applyRemote({ ...snapshot.records, trees: [snapshot.tree] })
  if (snapshot.ancestorTrees?.length) {
    const nextLinks = new Map(ancestorTreeLinks)
    for (const link of snapshot.ancestorTrees) {
      nextLinks.set(link.personId, link.treeId)
    }
    ancestorTreeLinks = nextLinks
  }
  update(
    (previous) => ({
      ...previous,
      index: previous.index.map((tree) =>
        tree.id === snapshot.tree.id
          ? {
              ...tree,
              syncVersion: snapshot.syncVersion,
              cursor: snapshot.cursor,
              loaded: tree.loaded || !snapshot.partial,
            }
          : tree,
      ),
    }),
    { remote: true },
  )
}

async function runTreeSynchronization(treeId: string): Promise<void> {
  const generation = storeGeneration
  let cursor = state.index.find((tree) => tree.id === treeId)?.cursor
  if (!cursor) {
    const snapshot = await fetchTreeSnapshot(treeId)
    if (generation === storeGeneration) applyTreeSnapshot(snapshot)
    return
  }
  let hasMore = true
  while (hasMore) {
    const parameters = new URLSearchParams({ treeId, cursor, limit: "100" })
    const response = await fetch(`/api/changes?${parameters}`, {
      credentials: "include",
    })
    if (generation !== storeGeneration) return
    if (response.status === 404) {
      const manifest = await fetchTreeManifest()
      if (generation === storeGeneration) applyTreeManifest(manifest)
      return
    }
    if (response.status === 410) {
      const snapshot = await fetchTreeSnapshot(treeId)
      if (generation === storeGeneration) applyTreeSnapshot(snapshot)
      return
    }
    if (!response.ok) throw new Error(`changes failed: ${response.status}`)
    const page = (await response.json()) as SyncChangePage
    if (generation !== storeGeneration) return
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
  const existing = treeSyncInFlight.get(treeId)
  if (existing) await existing
  if (signal?.aborted) return
  return synchronizeTree(treeId)
}

async function runPushLoop(generation: number): Promise<void> {
  let authoritativePullNeeded = false
  while (generation === storeGeneration) {
    const pending = snapshotDirty()
    const operationId = firstPendingOperation(pending)
    if (operationExceedsRecordLimits(pending, operationId)) {
      blockOperation(pending, operationId)
      return
    }
    const dirty = takeDirtyBatch(pending, MAX_SYNC_BATCH_RECORDS)
    const request = buildPushWires(state, dirty, new Date().toISOString())
    if (
      RECORD_COLLECTIONS.every((collection) => request[collection].length === 0)
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
    const batchKey = dirtyBatchKey(dirty)
    const mutationId = mutationIdsByBatch.get(batchKey) ?? newId()
    mutationIdsByBatch.set(batchKey, mutationId)

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
      const result = (await response.json()) as SyncMutationResponse
      if (!response.ok && response.status !== 409) {
        throw new Error(`push failed: ${response.status}`)
      }
      if (generation !== storeGeneration) return
      mutationIdsByBatch.delete(batchKey)
      schedulePersistence()
      acknowledgeApplied(result, dirty)
      clearDirty(result.applied, dirty)
      applyAliases(result)
      if (result.status === "conflict") {
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
        if (generation !== storeGeneration) return
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

function pushDirty(): Promise<void> {
  if (pushInFlight && pushInFlightGeneration === storeGeneration) {
    return pushInFlight
  }
  const generation = storeGeneration
  const execute = () => runPushLoop(generation)
  const execution =
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          `family-tree-sync:${persistenceUserId ?? "anonymous"}`,
          execute,
        )
      : execute()
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

type RemoteWire = { updatedAt: string; deletedAt?: string; revision?: number }

function remoteIsNewer(
  local: { updatedAt?: string; revision?: number },
  remote: RemoteWire,
): boolean {
  if (local.revision !== undefined && remote.revision !== undefined) {
    return remote.revision > local.revision
  }
  return remote.deletedAt
    ? (local.updatedAt ?? "") <= remote.updatedAt
    : (local.updatedAt ?? "") < remote.updatedAt
}

function tombstoneBlocks(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
  revision?: number,
): boolean {
  const clock = remoteTombstoneClocks[collection].get(id)
  if (!clock) return false
  if (clock.revision !== undefined && revision !== undefined) {
    return clock.revision >= revision
  }
  return clock.updatedAt >= updatedAt
}

function recordTombstone(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
  revision?: number,
): void {
  const current = remoteTombstoneClocks[collection].get(id)
  if (
    !current
    || (revision !== undefined && current.revision !== undefined
      ? revision > current.revision
      : updatedAt > current.updatedAt)
  ) {
    remoteTombstoneClocks[collection].set(id, { updatedAt, revision })
  }
}

function mergeRemoteRecords<
  T extends { updatedAt: string; revision?: number },
  W extends RemoteWire,
>(
  records: Record<string, T>,
  wires: Iterable<W> | undefined,
  collection: Exclude<DirtyCollection, "persons" | "trees">,
  keyFor: (wire: W) => string,
  toRecord: (wire: W) => T,
): Record<string, T> {
  if (!wires) return records
  let result = records
  for (const wire of wires) {
    const id = keyFor(wire)
    const local = result[id]
    if (tombstoneBlocks(collection, id, wire.updatedAt, wire.revision)) continue
    if (dirtyState[collection].has(id)) continue
    if (local && !remoteIsNewer(local, wire)) continue
    if (result === records) result = { ...records }
    if (wire.deletedAt) {
      recordTombstone(collection, id, wire.updatedAt, wire.revision)
      delete result[id]
    } else result[id] = toRecord(wire)
  }
  return result
}

export type RemoteRecords = {
  persons?: Iterable<PersonWire>
  trees?: Iterable<TreeWire>
  treeMembers?: Iterable<TreeMemberWire>
  unions?: Iterable<UnionWire>
  unionEvents?: Iterable<UnionEventWire>
  treeUnions?: Iterable<TreeUnionWire>
  parentChildRelationships?: Iterable<ParentChildRelationshipWire>
  treeParentChildRelationships?: Iterable<TreeParentChildRelationshipWire>
}

/** Merge each normalized record independently using its own timestamp. */
export function applyRemote(remote: RemoteRecords): void {
  update(
    (previous) => {
      let persons = previous.persons
      if (remote.persons) {
        for (const wire of remote.persons) {
          const local = persons[wire.id]
          if (
            tombstoneBlocks("persons", wire.id, wire.updatedAt, wire.revision)
          ) {
            continue
          }
          if (dirtyState.persons.has(wire.id)) continue
          if (local && !remoteIsNewer(local, wire)) continue
          if (persons === previous.persons) persons = { ...persons }
          if ("deletedAt" in wire) {
            recordTombstone("persons", wire.id, wire.updatedAt, wire.revision)
            delete persons[wire.id]
          } else {
            persons[wire.id] = {
              id: wire.id,
              name: wire.name,
              dob: wire.dob,
              dod: wire.dod,
              gender: wire.gender,
              birthplace: wire.birthplace,
              photo: wire.hasPhoto ? STORED_PHOTO_MARKER : wire.photo,
              revision: wire.revision,
              updatedAt: wire.updatedAt,
              ownerId: wire.ownerId,
            }
          }
        }
      }

      let index = previous.index
      const deletedTrees = new Map<string, string>()
      if (remote.trees) {
        const byId = new Map(index.map((tree) => [tree.id, tree] as const))
        for (const wire of remote.trees) {
          const local = byId.get(wire.id)
          if (
            tombstoneBlocks("trees", wire.id, wire.updatedAt, wire.revision)
          ) {
            continue
          }
          const dirtyTree = dirtyState.trees.get(wire.id)
          if (dirtyTree) {
            if (!("deletedAt" in wire) && local) {
              const role = wire.role ?? local.role
              const ownerEmail =
                wire.ownerEmail !== undefined
                  ? wire.ownerEmail
                  : local.ownerEmail
              if (role !== local.role || ownerEmail !== local.ownerEmail) {
                if (index === previous.index) index = [...index]
                const position = index.findIndex((tree) => tree.id === wire.id)
                if (position >= 0)
                  index[position] = { ...local, role, ownerEmail }
              }
            }
            continue
          }
          if ("deletedAt" in wire) {
            if (local && !remoteIsNewer(local, wire)) continue
          } else if (local) {
            const role = wire.role ?? local.role
            const ownerEmail =
              wire.ownerEmail !== undefined ? wire.ownerEmail : local.ownerEmail
            const accessChanged =
              role !== local.role || ownerEmail !== local.ownerEmail
            if (!remoteIsNewer(local, wire)) {
              if (accessChanged) {
                if (index === previous.index) index = [...index]
                const position = index.findIndex((tree) => tree.id === wire.id)
                const replacement = { ...local, role, ownerEmail }
                if (position >= 0) index[position] = replacement
                byId.set(wire.id, replacement)
              }
              continue
            }
            if ((local.updatedAt ?? "") === wire.updatedAt && !accessChanged) {
              continue
            }
          }
          if (index === previous.index) index = [...index]
          const position = index.findIndex((tree) => tree.id === wire.id)
          if ("deletedAt" in wire) {
            if (position >= 0) index.splice(position, 1)
            recordTombstone("trees", wire.id, wire.updatedAt, wire.revision)
            deletedTrees.set(wire.id, wire.updatedAt)
            byId.delete(wire.id)
          } else {
            const replacement: TreeMeta = {
              id: wire.id,
              name: wire.name,
              createdAt: wire.createdAt,
              revision: wire.revision,
              updatedAt: wire.updatedAt,
              ownerId: wire.ownerId,
              ownerEmail: wire.ownerEmail ?? local?.ownerEmail,
              role: wire.role ?? local?.role,
              syncVersion: local?.syncVersion,
              memberCount: local?.memberCount,
              loaded: local?.loaded,
            }
            if (position >= 0) index[position] = replacement
            else index.push(replacement)
            byId.set(wire.id, replacement)
          }
        }
      }

      let treeMembers = mergeRemoteRecords(
        previous.treeMembers,
        remote.treeMembers,
        "treeMembers",
        (wire) => treeMemberKey(wire.treeId, wire.personId),
        (wire) => {
          if (!("createdAt" in wire)) throw new Error("Invalid member wire")
          return wire
        },
      )
      const unions = mergeRemoteRecords(
        previous.unions,
        remote.unions,
        "unions",
        (wire) => wire.id,
        (wire) => {
          if (!("firstPersonId" in wire)) throw new Error("Invalid union wire")
          return wire
        },
      )
      const unionEvents = mergeRemoteRecords(
        previous.unionEvents,
        remote.unionEvents,
        "unionEvents",
        (wire) => wire.id,
        (wire) => {
          if (!("unionId" in wire)) throw new Error("Invalid union event wire")
          return wire
        },
      )
      let treeUnions = mergeRemoteRecords(
        previous.treeUnions,
        remote.treeUnions,
        "treeUnions",
        (wire) => treeUnionKey(wire.treeId, wire.unionId),
        (wire) => {
          if (!("createdAt" in wire)) throw new Error("Invalid tree union wire")
          return wire
        },
      )
      const parentChildRelationships = mergeRemoteRecords(
        previous.parentChildRelationships,
        remote.parentChildRelationships,
        "parentChildRelationships",
        (wire) => wire.id,
        (wire) => {
          if (!("parentPersonId" in wire)) {
            throw new Error("Invalid parent-child wire")
          }
          return wire
        },
      )
      let treeParentChildRelationships = mergeRemoteRecords(
        previous.treeParentChildRelationships,
        remote.treeParentChildRelationships,
        "treeParentChildRelationships",
        (wire) =>
          treeParentChildRelationshipKey(
            wire.treeId,
            wire.parentChildRelationshipId,
          ),
        (wire) => {
          if (!("createdAt" in wire)) {
            throw new Error("Invalid tree parent-child wire")
          }
          return wire
        },
      )

      if (deletedTrees.size > 0) {
        for (const [key, record] of Object.entries(treeMembers)) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeMembers", key, deletedAt)
        }
        for (const [key, record] of Object.entries(treeUnions)) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeUnions", key, deletedAt)
        }
        for (const [key, record] of Object.entries(
          treeParentChildRelationships,
        )) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeParentChildRelationships", key, deletedAt)
        }
        treeMembers = Object.fromEntries(
          Object.entries(treeMembers).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
        treeUnions = Object.fromEntries(
          Object.entries(treeUnions).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
        treeParentChildRelationships = Object.fromEntries(
          Object.entries(treeParentChildRelationships).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
      }

      const next: GlobalState = {
        persons,
        index,
        treeMembers,
        unions,
        unionEvents,
        treeUnions,
        parentChildRelationships,
        treeParentChildRelationships,
      }
      return Object.keys(next).every(
        (key) =>
          next[key as keyof GlobalState] === previous[key as keyof GlobalState],
      )
        ? previous
        : next
    },
    { remote: true },
  )
}

function sharedRemoteRecords(
  shared: SyncPullResponse["shared"][number],
): RemoteRecords {
  return {
    persons: shared.persons,
    trees: [
      {
        ...shared.tree,
        role: shared.role,
        ownerEmail: shared.ownerEmail,
      },
    ],
    treeMembers: shared.treeMembers,
    unions: shared.unions,
    unionEvents: shared.unionEvents,
    treeUnions: shared.treeUnions,
    parentChildRelationships: shared.parentChildRelationships,
    treeParentChildRelationships: shared.treeParentChildRelationships,
  }
}

/** Replace the complete local graph from an authoritative epoch pull. */
export function applyFullPull(pull: SyncPullResponse): void {
  const previous = state
  const pendingDirty = snapshotDirty()
  const previousTombstoneIds = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...remoteTombstoneClocks[collection].keys()],
    ]),
  ) as Record<DirtyCollection, string[]>
  notificationsSuppressed = true
  try {
    state = emptyState()
    dirtyState = emptyDirtyState()
    ancestorTreeLinks = new Map()
    remoteTombstoneClocks = emptyTombstoneClocks()
    applyRemote(pull.own)
    for (const shared of pull.shared) applyRemote(sharedRemoteRecords(shared))
    for (const id of new Set([
      ...Object.keys(previous.persons),
      ...previousTombstoneIds.persons,
    ])) {
      if (!state.persons[id] && !pendingDirty.persons.has(id)) {
        recordTombstone("persons", id, pull.serverTime)
      }
    }
    const nextTreeIds = new Set(state.index.map((tree) => tree.id))
    for (const id of new Set([
      ...previous.index.map((tree) => tree.id),
      ...previousTombstoneIds.trees,
    ])) {
      if (!nextTreeIds.has(id) && !pendingDirty.trees.has(id)) {
        recordTombstone("trees", id, pull.serverTime)
      }
    }
    const normalizedCollections = [
      "treeMembers",
      "unions",
      "unionEvents",
      "treeUnions",
      "parentChildRelationships",
      "treeParentChildRelationships",
    ] as const
    for (const collection of normalizedCollections) {
      for (const id of new Set([
        ...Object.keys(previous[collection]),
        ...previousTombstoneIds[collection],
      ])) {
        if (!state[collection][id] && !pendingDirty[collection].has(id)) {
          recordTombstone(collection, id, pull.serverTime)
        }
      }
    }

    const replayRecords = <T extends { revision?: number; updatedAt?: string }>(
      serverRecords: Record<string, T>,
      localRecords: Record<string, T>,
      pending: DirtyMap,
    ): Record<string, T> => {
      const replayed = { ...serverRecords }
      for (const [id, dirty] of pending) {
        if (dirty.action === "delete") {
          delete replayed[id]
          continue
        }
        const local = localRecords[id]
        if (!local) continue
        const server = serverRecords[id]
        replayed[id] = server
          ? {
              ...local,
              revision: server.revision,
              ...(server.updatedAt ? { updatedAt: server.updatedAt } : {}),
            }
          : local
      }
      return replayed
    }

    const serverTrees = new Map(state.index.map((tree) => [tree.id, tree]))
    const localTrees = new Map(previous.index.map((tree) => [tree.id, tree]))
    for (const [id, dirty] of pendingDirty.trees) {
      const position = state.index.findIndex((tree) => tree.id === id)
      if (dirty.action === "delete") {
        if (position >= 0) state.index.splice(position, 1)
        continue
      }
      const local = localTrees.get(id)
      if (!local) continue
      const server = serverTrees.get(id)
      const replayed = server
        ? {
            ...local,
            revision: server.revision,
            updatedAt: server.updatedAt,
            role: server.role,
            ownerId: server.ownerId,
            ownerEmail: server.ownerEmail,
          }
        : local
      if (position >= 0) state.index[position] = replayed
      else state.index.push(replayed)
    }
    state.persons = replayRecords(
      state.persons,
      previous.persons,
      pendingDirty.persons,
    )
    state.treeMembers = replayRecords(
      state.treeMembers,
      previous.treeMembers,
      pendingDirty.treeMembers,
    )
    state.unions = replayRecords(
      state.unions,
      previous.unions,
      pendingDirty.unions,
    )
    state.unionEvents = replayRecords(
      state.unionEvents,
      previous.unionEvents,
      pendingDirty.unionEvents,
    )
    state.treeUnions = replayRecords(
      state.treeUnions,
      previous.treeUnions,
      pendingDirty.treeUnions,
    )
    state.parentChildRelationships = replayRecords(
      state.parentChildRelationships,
      previous.parentChildRelationships,
      pendingDirty.parentChildRelationships,
    )
    state.treeParentChildRelationships = replayRecords(
      state.treeParentChildRelationships,
      previous.treeParentChildRelationships,
      pendingDirty.treeParentChildRelationships,
    )
    dirtyState = pendingDirty
    nextRevision =
      Math.max(
        0,
        ...RECORD_COLLECTIONS.flatMap((collection) =>
          [...dirtyState[collection].values()].map((record) => record.revision),
        ),
      ) + 1
  } finally {
    notificationsSuppressed = false
  }
  notifyListeners()
}

// ---------------------------------------------------------------------------
// Store lifecycle helpers.
// ---------------------------------------------------------------------------

export function getGraph(): GlobalState {
  return state
}

export function getAncestorTreeLinks(): Map<string, string> {
  return ancestorTreeLinks
}

function getHydrated(): boolean {
  return hydrated
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setHydrated(value: boolean): void {
  if (hydrated === value) return
  hydrated = value
  notifyListeners()
}

export function resetStore(): void {
  storeGeneration++
  state = emptyState()
  dirtyState = emptyDirtyState()
  remoteTombstoneClocks = emptyTombstoneClocks()
  ancestorTreeLinks = new Map()
  nextRevision = 1
  deviceId = newId()
  mutationIdsByBatch.clear()
  clearedDirtyTokens.clear()
  syncConflicts = []
  operationConflicts = []
  clearedConflictIds.clear()
  treeSyncInFlight.clear()
  persistenceUserId = null
  persistenceScheduled = false
  persistenceRestore = undefined
  persistenceRestoreUserId = null
  persistenceRestoreToken++
  setHydrated(false)
}

export async function restorePersistentStore(userId: string): Promise<void> {
  if (persistenceRestoreUserId === userId && persistenceRestore) {
    await persistenceRestore
    return
  }
  persistenceUserId = userId
  persistenceRestoreUserId = userId
  const generation = storeGeneration
  const token = ++persistenceRestoreToken
  persistenceRestore = (async () => {
    const persisted = await loadPersistedStore(userId)
    if (
      !persisted
      || generation !== storeGeneration
      || persistenceUserId !== userId
      || token !== persistenceRestoreToken
    ) {
      return
    }
    state = persisted.state
    dirtyState = Object.fromEntries(
      RECORD_COLLECTIONS.map((collection) => [
        collection,
        new Map(persisted.dirty[collection] ?? []),
      ]),
    ) as DirtyState
    deviceId = persisted.deviceId || newId()
    mutationIdsByBatch.clear()
    for (const [key, value] of persisted.mutationIdsByBatch) {
      mutationIdsByBatch.set(key, value)
    }
    clearedDirtyTokens.clear()
    for (const token of persisted.clearedDirtyTokens ?? []) {
      clearedDirtyTokens.add(token)
    }
    syncConflicts = persisted.conflicts ?? []
    operationConflicts = persisted.operationConflicts ?? []
    clearedConflictIds.clear()
    for (const conflictId of persisted.clearedConflictIds ?? []) {
      clearedConflictIds.add(conflictId)
    }
    nextRevision = Math.max(1, persisted.nextRevision)
    syncStatus = RECORD_COLLECTIONS.some((collection) =>
      [...dirtyState[collection].values()].some((record) => record.blocked),
    )
      ? "conflict"
      : RECORD_COLLECTIONS.some((collection) => dirtyState[collection].size > 0)
        ? "saving"
        : "saved"
    notifyListeners()
  })()
  await persistenceRestore
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated)
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => syncStatus,
    () => syncStatus,
  )
}

export function useSyncConflictCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => syncConflicts.length,
    () => syncConflicts.length,
  )
}

function getBlockedChangesSnapshot(treeId: string): BlockedChange[] {
  const cached = blockedChangesCache.get(treeId)
  if (cached?.version === blockedChangesVersion) return cached.changes
  const fallback = blockedChangesForTree(state, dirtyState, treeId)
  const changes = fallback.map((change) => {
    const conflict = operationConflicts.find(
      (candidate) => candidate.operationId === change.id,
    )
    if (!conflict) return change
    const fields = (value: unknown) => {
      if (value === undefined) return [{ label: "Record", value: "Deleted" }]
      if (!value || typeof value !== "object") {
        return [{ label: "Value", value: String(value) }]
      }
      return Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["revision", "updatedAt", "ownerId"].includes(key))
        .map(([label, fieldValue]) => ({
          label,
          value: fieldValue == null ? "Not set" : String(fieldValue),
        }))
    }
    return {
      ...change,
      reason: conflict.reason,
      retryable: conflict.retryable,
      device: conflict.records.flatMap((record) => fields(record.deviceValue)),
      server: conflict.records.flatMap((record) => fields(record.serverValue)),
    }
  })
  blockedChangesCache.set(treeId, { version: blockedChangesVersion, changes })
  return changes
}

export function resolveBlockedOperation(
  operationId: string,
  resolution: "device" | "server",
): void {
  const conflict = operationConflicts.find(
    (candidate) => candidate.operationId === operationId,
  )
  if (!conflict) return
  operationConflicts = operationConflicts.filter(
    (candidate) => candidate.operationId !== operationId,
  )
  if (resolution === "server") {
    for (const record of conflict.records) {
      const current = dirtyState[record.collection].get(record.id)
      if (current?.revision !== record.dirty.revision) continue
      dirtyState[record.collection].delete(record.id)
      if (record.collection === "trees") {
        state.index = state.index.filter((tree) => tree.id !== record.id)
        if (
          record.serverValue
          && !("deletedAt" in (record.serverValue as object))
        ) {
          state.index.push(record.serverValue as TreeMeta)
        }
      } else {
        const records = state[record.collection] as Record<string, unknown>
        if (
          !record.serverValue
          || "deletedAt" in (record.serverValue as object)
        ) {
          delete records[record.id]
        } else records[record.id] = record.serverValue
      }
    }
  } else {
    const retryOperationId = newId()
    for (const record of conflict.records) {
      const current = dirtyState[record.collection].get(record.id)
      if (current?.revision !== record.dirty.revision) continue
      const serverRevision = (
        record.serverValue as { revision?: number } | undefined
      )?.revision
      dirtyState[record.collection].set(record.id, {
        ...current,
        blocked: false,
        baseRevision: serverRevision,
        revision: nextRevision++,
        operationId: retryOperationId,
      })
    }
  }
  schedulePersistence()
  setSyncStatus(statusFromDirtyState())
  notifyListeners()
  if (resolution === "device") void pushDirty()
}

export function useBlockedChanges(treeId: string): BlockedChange[] {
  return useSyncExternalStore(
    subscribe,
    () => getBlockedChangesSnapshot(treeId),
    () => getBlockedChangesSnapshot(treeId),
  )
}

export function resolveNextSyncConflict(
  resolution: "current" | "alternate",
): void {
  const conflict = syncConflicts.shift()
  if (!conflict) return
  clearedConflictIds.add(conflict.conflictId)

  if (resolution === "alternate") {
    update((previous) => {
      const draft = makeDraft(previous)
      if (conflict.collection === "trees") {
        draft.index = previous.index.filter((tree) => tree.id !== conflict.id)
        if (conflict.record.action === "upsert" && conflict.value) {
          const current = previous.index.find((tree) => tree.id === conflict.id)
          draft.index.push({
            ...(conflict.value as TreeMeta),
            revision: current?.revision,
            updatedAt: current?.updatedAt,
            ownerId: current?.ownerId,
            ownerEmail: current?.ownerEmail,
            role: current?.role,
          })
        }
      } else {
        const records = draft[conflict.collection] as unknown as Record<
          string,
          unknown
        >
        if (conflict.record.action === "delete") delete records[conflict.id]
        else if (conflict.value !== undefined) {
          const current = records[conflict.id]
          records[conflict.id] =
            current
            && typeof current === "object"
            && conflict.value
            && typeof conflict.value === "object"
              ? {
                  ...(conflict.value as Record<string, unknown>),
                  revision: (current as { revision?: number }).revision,
                  updatedAt: (current as { updatedAt?: string }).updatedAt,
                }
              : conflict.value
        }
      }
      return draft
    })
    return
  }

  const current = dirtyState[conflict.collection].get(conflict.id)
  if (current) {
    dirtyState[conflict.collection].set(conflict.id, {
      ...current,
      blocked: false,
      revision: nextRevision++,
      operationId: newId(),
      sourceId: storeInstanceId,
      changedAt: Date.now(),
    })
    setSyncStatus("saving")
    schedulePersistence()
    notifyListeners()
    void pushDirty()
  } else {
    setSyncStatus(statusFromDirtyState())
    schedulePersistence()
    notifyListeners()
  }
}

export function now(): string {
  return new Date().toISOString()
}

export function makeDraft(previous: GlobalState): GlobalState {
  return {
    persons: { ...previous.persons },
    index: previous.index,
    treeMembers: { ...previous.treeMembers },
    unions: { ...previous.unions },
    unionEvents: { ...previous.unionEvents },
    treeUnions: { ...previous.treeUnions },
    parentChildRelationships: { ...previous.parentChildRelationships },
    treeParentChildRelationships: {
      ...previous.treeParentChildRelationships,
    },
  }
}
