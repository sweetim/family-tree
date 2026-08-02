import { useSyncExternalStore } from "react"
import type {
  ParentChildRelationshipRecordWire,
  ParentChildRelationshipWire,
  PersonPushWire,
  PersonRecordWire,
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
  TreeParentChildRelationshipRecordWire,
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
  type PersistedPendingMutation,
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
const SNAPSHOT_RECORD_COLLECTIONS = [
  "persons",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const satisfies readonly (keyof TreeSnapshotResponse["records"])[]

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
  conflictId?: string
  force?: boolean
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
let conflictResolutionInFlight: Promise<unknown> | undefined
const treeSyncInFlight = new Map<string, Promise<void>>()
const treeFreshSyncInFlight = new Map<string, Promise<void>>()
let deviceId = newId()
const storeInstanceId = newId()
const mutationIdsByBatch = new Map<string, string>()
const clearedDirtyTokens = new Set<string>()
let pendingMutation: PersistedPendingMutation | undefined
const clearedMutationIds = new Set<string>()
let syncConflicts: PersistedConflict[] = []
let operationConflicts: PersistedOperationConflict[] = []
const clearedOperationConflictIds = new Set<string>()
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

/**
 * Tree ids that have received a fresh server snapshot during the current store
 * generation. Unlike `TreeMeta.loaded` (which is persisted and so can already
 * be true on reload), this set only fills as `applyTreeSnapshot` runs this
 * session, so the tree view can hold its loading state until the first frame
 * reflects the authoritative server data instead of stale persisted state.
 */
let freshlyLoadedTrees = new Set<string>()

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
    clearedOperationConflictIds: [...clearedOperationConflictIds],
    pendingMutation,
    clearedMutationIds: [...clearedMutationIds],
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
      clearedOperationConflictIds.clear()
      for (const id of persisted.clearedOperationConflictIds ?? []) {
        clearedOperationConflictIds.add(id)
      }
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
    revision: nextRevision++,
    baseRevision: current?.blocked
      ? baseRevision
      : (current?.baseRevision ?? baseRevision),
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

/** Flatten a pull into one record set so authoritative revisions can be looked
 *  up for any accessible record, including ones outside a single tree. */
function pullRecordSet(pull: SyncPullResponse): SyncRecordSet {
  const result: SyncRecordSet = {
    persons: [],
    trees: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
  const append = (records: Partial<SyncRecordSet>) => {
    for (const collection of RECORD_COLLECTIONS) {
      const wires = records[collection]
      if (wires) result[collection].push(...(wires as never[]))
    }
  }
  append(pull.own)
  for (const shared of pull.shared) {
    append({ ...shared, trees: [shared.tree] })
  }
  return result
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
        conflictId: id,
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
  for (const collection of RECORD_COLLECTIONS) {
    for (const [recordId, sent] of source[collection]) {
      if (sent.operationId !== operationId) continue
      const current = dirtyState[collection].get(recordId)
      if (current?.revision === sent.revision) {
        dirtyState[collection].set(recordId, { ...current, conflictId: id })
      }
    }
  }
}

function recreateMissingParentDependencies(
  source: DirtyState,
  operationId: string | undefined,
  result: SyncMutationResponse,
): void {
  if (
    !operationId
    || result.status !== "conflict"
    || result.conflict?.reason !== "missing-parent-relationship"
  ) {
    return
  }
  const skippedAssociations = new Set(
    result.skipped.treeParentChildRelationships,
  )
  const missingRelationshipIds = new Set(
    result.conflict.missingDependencies?.parentChildRelationships ?? [],
  )
  const replacements = new Map<string, string>()
  for (const [id, associationDirty] of source.treeParentChildRelationships) {
    if (associationDirty.action !== "upsert" || !skippedAssociations.has(id)) {
      continue
    }
    const association = state.treeParentChildRelationships[id]
    const currentAssociationDirty =
      dirtyState.treeParentChildRelationships.get(id)
    if (!association) continue
    const relationshipId = association.parentChildRelationshipId
    if (!missingRelationshipIds.has(relationshipId)) continue
    const relationship = state.parentChildRelationships[relationshipId]
    const sourceRelationshipDirty =
      source.parentChildRelationships.get(relationshipId)
    const currentRelationshipDirty =
      dirtyState.parentChildRelationships.get(relationshipId)
    if (
      !relationship
      || currentAssociationDirty?.revision !== associationDirty.revision
      || (currentRelationshipDirty
        && (currentRelationshipDirty.operationId !== operationId
          || currentRelationshipDirty.revision
            !== sourceRelationshipDirty?.revision))
    ) {
      continue
    }
    const existingReplacementId = replacements.get(relationshipId)
    const replacementRelationshipId = existingReplacementId ?? newId()
    replacements.set(relationshipId, replacementRelationshipId)
    const replacementAssociationId = treeParentChildRelationshipKey(
      association.treeId,
      replacementRelationshipId,
    )
    const timestamp = now()
    const hasOtherAssociation = Object.entries(
      state.treeParentChildRelationships,
    ).some(
      ([key, candidate]) =>
        key !== id && candidate.parentChildRelationshipId === relationshipId,
    )
    update(
      (previous) => {
        const next = makeDraft(previous)
        delete next.treeParentChildRelationships[id]
        next.treeParentChildRelationships[replacementAssociationId] = {
          ...association,
          parentChildRelationshipId: replacementRelationshipId,
          revision: undefined,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        if (!hasOtherAssociation) {
          delete next.parentChildRelationships[relationshipId]
        }
        if (!existingReplacementId) {
          next.parentChildRelationships[replacementRelationshipId] = {
            ...relationship,
            id: replacementRelationshipId,
            revision: undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
          }
        }
        return next
      },
      { remote: true },
    )
    const token = dirtyToken(
      "treeParentChildRelationships",
      id,
      currentAssociationDirty,
    )
    if (token) clearedDirtyTokens.add(token)
    const replacementAssociationDirty: DirtyRecord = {
      ...associationDirty,
      revision: nextRevision++,
      baseRevision: undefined,
      blocked: true,
      operationId,
      conflictId: undefined,
    }
    source.treeParentChildRelationships.delete(id)
    source.treeParentChildRelationships.set(
      replacementAssociationId,
      replacementAssociationDirty,
    )
    dirtyState.treeParentChildRelationships.delete(id)
    dirtyState.treeParentChildRelationships.set(
      replacementAssociationId,
      replacementAssociationDirty,
    )
    if (!existingReplacementId) {
      if (currentRelationshipDirty) {
        const relationshipToken = dirtyToken(
          "parentChildRelationships",
          relationshipId,
          currentRelationshipDirty,
        )
        if (relationshipToken) clearedDirtyTokens.add(relationshipToken)
        source.parentChildRelationships.delete(relationshipId)
        dirtyState.parentChildRelationships.delete(relationshipId)
      }
      const dependencyDirty: DirtyRecord = {
        action: "upsert",
        revision: nextRevision++,
        blocked: true,
        operationId,
        sourceId: associationDirty.sourceId ?? storeInstanceId,
        changedAt: associationDirty.changedAt ?? Date.now(),
      }
      source.parentChildRelationships.set(
        replacementRelationshipId,
        dependencyDirty,
      )
      dirtyState.parentChildRelationships.set(
        replacementRelationshipId,
        dependencyDirty,
      )
    }
  }
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
      const dirtyPerson = dirty.persons.get(id)
      persons.push({
        id,
        name: person.name,
        familyName: person.familyName,
        dob: person.dob,
        dod: person.dod,
        gender: person.gender,
        birthplace: person.birthplace,
        revision: dirtyPerson?.baseRevision ?? person.revision,
        ...(isStoredPhotoMarker(person.photo)
          ? {}
          : { photo: person.photo ?? null }),
        updatedAt: person.updatedAt ?? now,
        ...(dirtyPerson?.force ? { force: true } : {}),
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
        revision: dirty.trees.get(id)?.baseRevision ?? tree.revision,
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
    } else {
      treeMembers.push({
        ...record,
        revision: dirty.treeMembers.get(id)?.baseRevision ?? record.revision,
      })
    }
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
        : {
            ...record,
            revision: dirty.unions.get(id)?.baseRevision ?? record.revision,
          },
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
        : {
            ...record,
            revision:
              dirty.unionEvents.get(id)?.baseRevision ?? record.revision,
          },
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
    } else {
      treeUnions.push({
        ...record,
        revision: dirty.treeUnions.get(id)?.baseRevision ?? record.revision,
      })
    }
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
        : {
            ...record,
            revision:
              dirty.parentChildRelationships.get(id)?.baseRevision
              ?? record.revision,
          },
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
    } else {
      treeParentChildRelationships.push({
        ...record,
        revision:
          dirty.treeParentChildRelationships.get(id)?.baseRevision
          ?? record.revision,
      })
    }
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

function persistableDirty(
  dirty: DirtyState,
): PersistedPendingMutation["dirty"] {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...dirty[collection]],
    ]),
  ) as PersistedPendingMutation["dirty"]
}

function restoredDirty(dirty: PersistedPendingMutation["dirty"]): DirtyState {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map(dirty[collection] ?? []),
    ]),
  ) as DirtyState
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
  let nextCursor: string | undefined
  let aggregate: SyncPullResponse | undefined
  do {
    const parameters = new URLSearchParams({ since: EPOCH })
    if (nextCursor) parameters.set("pageCursor", nextCursor)
    const response = await fetch(`/api/sync?${parameters}`, {
      credentials: "include",
    })
    if (!response.ok) throw new Error(`pull failed: ${response.status}`)
    const page = (await response.json()) as SyncPullResponse
    if (aggregate && page.serverTime !== aggregate.serverTime) {
      throw new Error("sync pull changed while loading")
    }
    if (!aggregate) {
      aggregate = page
    } else {
      for (const collection of RECORD_COLLECTIONS) {
        aggregate.own[collection].push(...(page.own[collection] as never[]))
      }
      const sharedByTree = new Map(
        aggregate.shared.map((shared) => [shared.tree.id, shared]),
      )
      for (const sharedPage of page.shared) {
        const shared = sharedByTree.get(sharedPage.tree.id)
        if (!shared) {
          aggregate.shared.push(sharedPage)
          sharedByTree.set(sharedPage.tree.id, sharedPage)
          continue
        }
        for (const collection of SNAPSHOT_RECORD_COLLECTIONS) {
          shared[collection].push(...(sharedPage[collection] as never[]))
        }
      }
      aggregate.nextCursor = page.nextCursor
    }
    nextCursor = page.nextCursor
  } while (nextCursor)
  if (!aggregate) throw new Error("sync pull returned no pages")
  return aggregate
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
  const basePath = focusPersonId
    ? `/api/trees/${encodeURIComponent(treeId)}/graph?focusPersonId=${encodeURIComponent(focusPersonId)}&radius=3`
    : `/api/trees/${encodeURIComponent(treeId)}/snapshot`
  let restartCount = 0
  while (true) {
    let nextCursor: string | undefined
    let aggregate: TreeSnapshotResponse | undefined
    do {
      const path = nextCursor
        ? `${basePath}${basePath.includes("?") ? "&" : "?"}pageCursor=${encodeURIComponent(nextCursor)}`
        : basePath
      const response = await fetch(path, { credentials: "include" })
      if (response.status === 409 && restartCount === 0) {
        restartCount++
        aggregate = undefined
        nextCursor = undefined
        break
      }
      if (!response.ok) {
        throw Object.assign(
          new Error(`tree snapshot failed: ${response.status}`),
          { status: response.status },
        )
      }
      const page = (await response.json()) as TreeSnapshotResponse
      if (
        aggregate
        && (page.tree.id !== aggregate.tree.id
          || page.syncVersion !== aggregate.syncVersion)
      ) {
        throw new Error("tree snapshot changed while loading")
      }
      if (aggregate) {
        const current = aggregate
        aggregate = {
          ...current,
          records: Object.fromEntries(
            SNAPSHOT_RECORD_COLLECTIONS.map((collection) => [
              collection,
              [...current.records[collection], ...page.records[collection]],
            ]),
          ) as TreeSnapshotResponse["records"],
          ancestorTrees: [
            ...(current.ancestorTrees ?? []),
            ...(page.ancestorTrees ?? []),
          ],
          nextCursor: page.nextCursor,
        }
      } else {
        aggregate = page
      }
      nextCursor = page.nextCursor
    } while (nextCursor)
    if (aggregate && !aggregate.nextCursor) return aggregate
    if (restartCount > 0) continue
  }
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
  freshlyLoadedTrees.add(snapshot.tree.id)
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
  const activeFreshSynchronization = treeFreshSyncInFlight.get(treeId)
  if (activeFreshSynchronization) return activeFreshSynchronization
  const existing = treeSyncInFlight.get(treeId)
  const generation = storeGeneration
  const synchronization = (async () => {
    if (existing) await existing
    const snapshot = await fetchTreeSnapshot(treeId)
    if (generation !== storeGeneration) return
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

async function runPushLoop(generation: number): Promise<void> {
  let authoritativePullNeeded = false
  while (generation === storeGeneration) {
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
      request = buildPushWires(state, dirty, new Date().toISOString())
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
      const result = (await response.json()) as SyncMutationResponse
      if (!response.ok && response.status !== 409) {
        throw new Error(`push failed: ${response.status}`)
      }
      if (generation !== storeGeneration) return
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

function runWithCrossTabSyncLock<Value>(
  execute: () => Promise<Value>,
): Promise<Value> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(
        `family-tree-sync:${persistenceUserId ?? "anonymous"}`,
        execute,
      )
    : execute()
}

function pushDirty(): Promise<void> {
  if (pushInFlight && pushInFlightGeneration === storeGeneration) {
    return pushInFlight
  }
  const generation = storeGeneration
  const execute = async () => {
    const conflictResolution = conflictResolutionInFlight
    if (conflictResolution) await conflictResolution
    if (generation !== storeGeneration) return
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
              familyName: wire.familyName ?? "",
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
  freshlyLoadedTrees = new Set()
  nextRevision = 1
  deviceId = newId()
  mutationIdsByBatch.clear()
  clearedDirtyTokens.clear()
  pendingMutation = undefined
  clearedMutationIds.clear()
  syncConflicts = []
  operationConflicts = []
  clearedOperationConflictIds.clear()
  clearedConflictIds.clear()
  treeSyncInFlight.clear()
  treeFreshSyncInFlight.clear()
  conflictResolutionInFlight = undefined
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
    pendingMutation = persisted.pendingMutation
    clearedMutationIds.clear()
    for (const id of persisted.clearedMutationIds ?? []) {
      clearedMutationIds.add(id)
    }
    syncConflicts = persisted.conflicts ?? []
    operationConflicts = persisted.operationConflicts ?? []
    clearedOperationConflictIds.clear()
    for (const id of persisted.clearedOperationConflictIds ?? []) {
      clearedOperationConflictIds.add(id)
    }
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

/**
 * True once the tree has received a fresh server snapshot during the current
 * store generation (i.e. `applyTreeSnapshot` has run for it this session).
 * Used to hold the tree view on its loading state until the first visible
 * frame is the authoritative server state, not stale persisted data.
 */
export function useTreeFreshlyLoaded(treeId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => freshlyLoadedTrees.has(treeId),
    () => freshlyLoadedTrees.has(treeId),
  )
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => syncStatus,
    () => syncStatus,
  )
}

export function getSyncStatus(): SyncStatus {
  return syncStatus
}

export function hasBlockedChanges(treeId: string): boolean {
  return blockedChangesForTree(state, dirtyState, treeId).length > 0
}

export function useSyncConflictCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => syncConflicts.length,
    () => syncConflicts.length,
  )
}

/** Server conflict reasons are protocol values; the panel shows people text. */
function conflictReasonText(reason: string, retryable: boolean): string {
  if (!retryable) {
    return reason === "tree-member-limit"
      ? "This tree has reached its limit on members."
      : reason === "tree-related-record-limit"
        ? "This tree has reached its limit on records."
        : "The server would not accept this change. Use the server version."
  }
  return reason === "missing-parent-relationship"
    ? "A record this change depends on is missing on the server."
    : "This change conflicts with a newer server version."
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
      if (value === undefined) return []
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
    const semanticFields = (
      side: "device" | "server",
    ): Array<{ label: string; value: string }> => {
      const summaries = conflict.records.flatMap((record) => {
        if (record.collection === "treeMembers") {
          return [
            {
              label: "Tree membership",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Removed from this tree"
                  : side === "server" && record.serverValue
                    ? "Member of this tree"
                    : "Not a member of this tree",
            },
          ]
        }
        if (
          record.collection === "parentChildRelationships"
          || record.collection === "treeParentChildRelationships"
        ) {
          return [
            {
              label: "Parent relationship",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Relationship removed"
                  : side === "server" && record.serverValue
                    ? "Relationship kept"
                    : "Relationship not present",
            },
          ]
        }
        if (record.collection === "treeUnions") {
          return [
            {
              label: "Marriage connection",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Connection removed"
                  : side === "server" && record.serverValue
                    ? "Connection kept"
                    : "Connection not present",
            },
          ]
        }
        return fields(
          side === "device" ? record.deviceValue : record.serverValue,
        )
      })
      const unique = [
        ...new Map(
          summaries.map((summary) => [
            `${summary.label}:${summary.value}`,
            summary,
          ]),
        ).values(),
      ]
      return unique.length > 0
        ? unique
        : [{ label: "Result", value: "Details unavailable" }]
    }
    return {
      ...change,
      reason: conflictReasonText(conflict.reason, conflict.retryable),
      retryable: conflict.retryable,
      device: semanticFields("device"),
      server: semanticFields("server"),
    }
  })
  blockedChangesCache.set(treeId, { version: blockedChangesVersion, changes })
  return changes
}

export async function resolveBlockedOperation(
  operationId: string,
  resolution: "device" | "server",
  treeId: string,
  attempt = 0,
): Promise<"resolved" | "stale" | "conflict" | "offline" | "unresolvable"> {
  const conflict = operationConflicts.find(
    (candidate) => candidate.operationId === operationId,
  )
  const isCurrentConflictRecord = (
    current: DirtyRecord | undefined,
    record: PersistedOperationConflict["records"][number],
  ): current is DirtyRecord =>
    Boolean(
      current
        && (current.conflictId === operationId
          || (!current.conflictId
            && current.blocked
            && (current.operationId === record.dirty.operationId
              || current.sourceId === record.dirty.sourceId))),
    )
  const legacyRecords = RECORD_COLLECTIONS.flatMap((collection) =>
    [...dirtyState[collection]]
      .filter(
        ([id, record]) =>
          record.blocked
          && (record.operationId === operationId
            || `${collection}:${id}` === operationId),
      )
      .map(([id, dirty]) => ({ collection, id, dirty })),
  )
  const capturedRecords = conflict
    ? conflict.records.flatMap((record) => {
        const current = dirtyState[record.collection].get(record.id)
        return isCurrentConflictRecord(current, record)
          ? [{ collection: record.collection, id: record.id, dirty: current }]
          : []
      })
    : []
  // A persisted conflict snapshot can drift out of sync with the live outbox
  // (cross-version persistence, a dependency-id rewrite, etc.). Always fall
  // back to the live blocked records for this operation so the user's choice
  // is acted on instead of silently no-op'ing as "stale".
  const currentRecords =
    capturedRecords.length > 0 ? capturedRecords : legacyRecords
  if (currentRecords.length === 0) {
    if (conflict) {
      operationConflicts = operationConflicts.filter(
        (candidate) => candidate.operationId !== operationId,
      )
      clearedOperationConflictIds.add(operationId)
      schedulePersistence()
      notifyListeners()
    }
    return "stale"
  }
  const matchesCapturedIntent = (
    current: DirtyRecord | undefined,
    captured: DirtyRecord,
  ): current is DirtyRecord =>
    Boolean(
      current?.blocked
        && current.operationId === captured.operationId
        && current.sourceId === captured.sourceId
        && current.action === captured.action,
    )

  if (resolution === "server") {
    const resolutionGeneration = storeGeneration
    const existingPush =
      pushInFlightGeneration === resolutionGeneration ? pushInFlight : undefined
    const execute = async () => {
      if (existingPush) await existingPush
      if (resolutionGeneration !== storeGeneration) return "stale" as const
      return runWithCrossTabSyncLock(async () => {
        let pull: SyncPullResponse
        try {
          pull = await fetchFullPull()
        } catch {
          return "offline" as const
        }
        let cleared = 0
        for (const record of currentRecords) {
          const current = dirtyState[record.collection].get(record.id)
          if (!matchesCapturedIntent(current, record.dirty)) continue
          const token = dirtyToken(record.collection, record.id, current)
          if (token) clearedDirtyTokens.add(token)
          dirtyState[record.collection].delete(record.id)
          cleared++
        }
        if (cleared === 0) return "stale" as const
        if (conflict) {
          operationConflicts = operationConflicts.filter(
            (candidate) => candidate.operationId !== operationId,
          )
          clearedOperationConflictIds.add(operationId)
        }
        applyFullPull(pull)
        schedulePersistence()
        setSyncStatus(statusFromDirtyState())
        notifyListeners()
        await persistCurrentStore()
        return "resolved" as const
      })
    }
    const resolutionPromise = execute().finally(() => {
      if (conflictResolutionInFlight === resolutionPromise) {
        conflictResolutionInFlight = undefined
      }
    })
    conflictResolutionInFlight = resolutionPromise
    return resolutionPromise
  } else {
    // Drop the captured conflict up front so a re-conflict can snapshot a
    // refreshed version under the same operation id. Reusing the id keeps the
    // review item stable instead of surfacing a duplicate under a new id. The
    // captured conflict is restored on the offline path so its comparison stays
    // available, and the id is only marked cleared once the push truly succeeds.
    if (conflict) {
      operationConflicts = operationConflicts.filter(
        (candidate) => candidate.operationId !== operationId,
      )
    }
    // Refresh the optimistic-concurrency base from a live snapshot so the retry
    // targets the server's current revision, not the one captured when the
    // conflict was first detected. The device version is kept; only the base
    // revision is refreshed. When the fetch fails (offline) the captured
    // revision is used and the push/offline handling below takes over.
    let freshRecords: SyncRecordSet | undefined
    let freshTreeRevision: number | undefined
    try {
      const snapshot = await fetchTreeSnapshot(treeId)
      freshRecords = { trees: [], ...snapshot.records }
      freshTreeRevision = snapshot.tree.revision
    } catch {
      freshRecords = undefined
    }
    if (conflict?.reason === "missing-parent-relationship" && freshRecords) {
      type CanonicalAdoption = {
        localRelationshipId: string
        canonicalRelationship: ParentChildRelationshipRecordWire
        associations: Array<{
          localKey: string
          canonicalKey: string
          canonicalAssociation: TreeParentChildRelationshipRecordWire
        }>
      }
      const serverRelationships = freshRecords.parentChildRelationships.filter(
        (wire): wire is ParentChildRelationshipRecordWire =>
          !("deletedAt" in wire),
      )
      const serverAssociations =
        freshRecords.treeParentChildRelationships.filter(
          (wire): wire is TreeParentChildRelationshipRecordWire =>
            !("deletedAt" in wire),
        )
      const coveredRecords = new Set<string>()
      const adoptions: CanonicalAdoption[] = []

      for (const record of currentRecords) {
        if (record.collection !== "parentChildRelationships") continue
        const current = dirtyState.parentChildRelationships.get(record.id)
        const localRelationship = state.parentChildRelationships[record.id]
        if (
          !matchesCapturedIntent(current, record.dirty)
          || !localRelationship
        ) {
          continue
        }
        const canonicalRelationship = serverRelationships.find(
          (candidate) =>
            candidate.parentPersonId === localRelationship.parentPersonId
            && candidate.childPersonId === localRelationship.childPersonId,
        )
        if (!canonicalRelationship) continue

        const localAssociations = currentRecords.filter((candidate) => {
          if (candidate.collection !== "treeParentChildRelationships") {
            return false
          }
          return (
            state.treeParentChildRelationships[candidate.id]
              ?.parentChildRelationshipId === record.id
          )
        })
        if (localAssociations.length === 0) continue

        const associations: CanonicalAdoption["associations"] = []
        let allAssociationsExist = true
        for (const associationRecord of localAssociations) {
          const localAssociation =
            state.treeParentChildRelationships[associationRecord.id]
          const canonicalAssociation = serverAssociations.find(
            (candidate) =>
              candidate.treeId === localAssociation?.treeId
              && candidate.parentChildRelationshipId
                === canonicalRelationship.id,
          )
          if (!localAssociation || !canonicalAssociation) {
            allAssociationsExist = false
            break
          }
          associations.push({
            localKey: associationRecord.id,
            canonicalKey: treeParentChildRelationshipKey(
              canonicalAssociation.treeId,
              canonicalRelationship.id,
            ),
            canonicalAssociation,
          })
        }
        if (!allAssociationsExist) continue

        coveredRecords.add(`parentChildRelationships:${record.id}`)
        for (const association of associations) {
          coveredRecords.add(
            `treeParentChildRelationships:${association.localKey}`,
          )
        }
        adoptions.push({
          localRelationshipId: record.id,
          canonicalRelationship,
          associations,
        })
      }

      const linkedPersonIds = new Set(
        adoptions.flatMap((adoption) => [
          adoption.canonicalRelationship.parentPersonId,
          adoption.canonicalRelationship.childPersonId,
        ]),
      )
      const serverPeople = freshRecords.persons.filter(
        (wire): wire is PersonRecordWire => !("deletedAt" in wire),
      )
      const authoritativePeople = new Map<string, PersonRecordWire>()
      for (const record of currentRecords) {
        if (
          record.collection !== "persons"
          || !linkedPersonIds.has(record.id)
        ) {
          continue
        }
        const current = dirtyState.persons.get(record.id)
        const localPerson = state.persons[record.id]
        const serverPerson = serverPeople.find(
          (candidate) => candidate.id === record.id,
        )
        if (
          !matchesCapturedIntent(current, record.dirty)
          || !localPerson
          || !serverPerson
        ) {
          continue
        }
        const photoMatches = serverPerson.hasPhoto
          ? isStoredPhotoMarker(localPerson.photo)
          : localPerson.photo === serverPerson.photo
        if (
          localPerson.name === serverPerson.name
          && localPerson.familyName === (serverPerson.familyName ?? "")
          && localPerson.dob === serverPerson.dob
          && localPerson.dod === serverPerson.dod
          && localPerson.gender === serverPerson.gender
          && localPerson.birthplace === serverPerson.birthplace
          && photoMatches
        ) {
          coveredRecords.add(`persons:${record.id}`)
          authoritativePeople.set(record.id, serverPerson)
        }
      }

      const operationAlreadyExistsOnServer =
        adoptions.length > 0
        && currentRecords.every((record) =>
          coveredRecords.has(`${record.collection}:${record.id}`),
        )
      if (operationAlreadyExistsOnServer) {
        for (const record of currentRecords) {
          const current = dirtyState[record.collection].get(record.id)
          if (!matchesCapturedIntent(current, record.dirty)) continue
          const token = dirtyToken(record.collection, record.id, current)
          if (token) clearedDirtyTokens.add(token)
          dirtyState[record.collection].delete(record.id)
        }
        update(
          (previous) => {
            const parentChildRelationships = {
              ...previous.parentChildRelationships,
            }
            const treeParentChildRelationships = {
              ...previous.treeParentChildRelationships,
            }
            const persons = { ...previous.persons }
            for (const serverPerson of authoritativePeople.values()) {
              persons[serverPerson.id] = {
                id: serverPerson.id,
                name: serverPerson.name,
                familyName: serverPerson.familyName ?? "",
                dob: serverPerson.dob,
                dod: serverPerson.dod,
                gender: serverPerson.gender,
                birthplace: serverPerson.birthplace,
                photo: serverPerson.hasPhoto
                  ? STORED_PHOTO_MARKER
                  : serverPerson.photo,
                revision: serverPerson.revision,
                updatedAt: serverPerson.updatedAt,
                ownerId: serverPerson.ownerId,
              }
            }
            for (const adoption of adoptions) {
              delete parentChildRelationships[adoption.localRelationshipId]
              parentChildRelationships[adoption.canonicalRelationship.id] = {
                ...adoption.canonicalRelationship,
              }
              for (const association of adoption.associations) {
                delete treeParentChildRelationships[association.localKey]
                treeParentChildRelationships[association.canonicalKey] = {
                  ...association.canonicalAssociation,
                }
              }
            }
            return {
              ...previous,
              persons,
              parentChildRelationships,
              treeParentChildRelationships,
            }
          },
          { remote: true },
        )
        clearedOperationConflictIds.add(operationId)
        schedulePersistence()
        setSyncStatus(statusFromDirtyState())
        notifyListeners()
        await persistCurrentStore()
        return "resolved"
      }
    }
    type ConflictRecordRef = { collection: DirtyCollection; id: string }
    const revisionIn = (
      records: SyncRecordSet | undefined,
      record: ConflictRecordRef,
    ): number | undefined =>
      records
        ? (
            recordSetValue(records, record.collection, record.id) as
              | { revision?: number }
              | undefined
          )?.revision
        : undefined
    const snapshotRevisionFor = (
      record: ConflictRecordRef,
    ): number | undefined =>
      record.collection === "trees" && record.id === treeId
        ? freshTreeRevision
        : revisionIn(freshRecords, record)
    const capturedRevisionFor = (
      record: ConflictRecordRef,
    ): number | undefined =>
      (
        conflict?.records.find(
          (candidate) =>
            candidate.collection === record.collection
            && candidate.id === record.id,
        )?.serverValue as { revision?: number } | undefined
      )?.revision
    // A tree snapshot only covers records still attached to that tree, and the
    // captured conflict only covers what the server chose to return. When
    // neither knows the authoritative revision of a record that does exist on
    // the server, the retry would resend the rejected base verbatim and be
    // refused again, so fall back to a pull, which spans every accessible
    // record.
    let pulledRecords: SyncRecordSet | undefined
    const missingAuthoritativeRevision = currentRecords.some((record) => {
      const current = dirtyState[record.collection].get(record.id)
      return (
        current?.baseRevision !== undefined
        && snapshotRevisionFor(record) === undefined
        && capturedRevisionFor(record) === undefined
      )
    })
    if (missingAuthoritativeRevision) {
      try {
        pulledRecords = pullRecordSet(await fetchFullPull())
      } catch {
        pulledRecords = undefined
      }
    }
    const attemptedBases = new Map<string, number | undefined>()
    let requeued = 0
    for (const record of currentRecords) {
      const current = dirtyState[record.collection].get(record.id)
      if (!matchesCapturedIntent(current, record.dirty)) continue
      const conflictRecord = conflict?.records.find(
        (candidate) =>
          candidate.collection === record.collection
          && candidate.id === record.id,
      )
      const capturedRevision = capturedRevisionFor(record)
      const freshRevision =
        snapshotRevisionFor(record) ?? revisionIn(pulledRecords, record)
      if (
        conflictRecord
        && current.action === "delete"
        && !conflictRecord.serverValue
      ) {
        const token = dirtyToken(record.collection, record.id, current)
        if (token) clearedDirtyTokens.add(token)
        dirtyState[record.collection].delete(record.id)
        continue
      }
      const baseRevision =
        freshRevision ?? capturedRevision ?? current.baseRevision
      attemptedBases.set(`${record.collection}:${record.id}`, baseRevision)
      dirtyState[record.collection].set(record.id, {
        ...current,
        blocked: false,
        baseRevision,
        revision: nextRevision++,
        operationId,
        conflictId: undefined,
        force: true,
      })
      requeued++
    }
    if (requeued === 0) {
      if (conflict) clearedOperationConflictIds.add(operationId)
      schedulePersistence()
      setSyncStatus(statusFromDirtyState())
      notifyListeners()
      await persistCurrentStore()
      return "resolved"
    }
    schedulePersistence()
    setSyncStatus(statusFromDirtyState())
    notifyListeners()
    if (pushInFlight && pushInFlightGeneration === storeGeneration) {
      await pushInFlight
    }
    await pushDirty()
    if (syncStatus === "offline") {
      for (const record of currentRecords) {
        const current = dirtyState[record.collection].get(record.id)
        if (current?.operationId !== operationId) continue
        dirtyState[record.collection].set(record.id, {
          ...record.dirty,
          blocked: true,
          revision: nextRevision++,
        })
      }
      if (conflict) operationConflicts = [...operationConflicts, conflict]
      setSyncStatus(statusFromDirtyState())
      schedulePersistence()
      notifyListeners()
      await persistCurrentStore()
      return "offline"
    }
    const retriedConflict = operationConflicts.find(
      (candidate) => candidate.operationId === operationId,
    )
    if (retriedConflict) {
      const recreatedMissingDependency =
        retriedConflict.reason === "missing-parent-relationship"
        && retriedConflict.records.some(
          (record) => !attemptedBases.has(`${record.collection}:${record.id}`),
        )
      if (recreatedMissingDependency) {
        // Recurse once to push the freshly-minted relationship id. If that
        // still misses its dependency, minting more ids cannot help — stop so
        // we never loop snapshot→mutation→sync indefinitely.
        if (attempt >= 1) return "unresolvable"
        return resolveBlockedOperation(
          operationId,
          "device",
          treeId,
          attempt + 1,
        )
      }
      // The rebased mutation was refused too. If the server reports the same
      // revisions this attempt already sent — or reports none at all — nothing
      // a further retry could send would differ, so the record was refused for
      // a reason optimistic concurrency cannot fix (a removed or unreachable
      // record, or a dependency the server does not have). Stop offering the
      // retry instead of looping the identical mutation.
      const madeProgress = retriedConflict.records.some((record) => {
        const key = `${record.collection}:${record.id}`
        if (!attemptedBases.has(key)) return false
        const serverRevision = (
          record.serverValue as { revision?: number } | undefined
        )?.revision
        return (
          serverRevision !== undefined
          && serverRevision !== attemptedBases.get(key)
        )
      })
      if (!madeProgress) {
        operationConflicts = operationConflicts.map((candidate) =>
          candidate.operationId === operationId
            ? { ...candidate, retryable: false }
            : candidate,
        )
        schedulePersistence()
        notifyListeners()
        await persistCurrentStore()
        return "unresolvable"
      }
      return "conflict"
    }
  }
  if (conflict) clearedOperationConflictIds.add(operationId)
  schedulePersistence()
  notifyListeners()
  await persistCurrentStore()
  return "resolved"
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
