import { create } from "zustand"
import type {
  ParentChildRelationshipRecordWire,
  PersonRecordWire,
  SyncChangePage,
  LocalRole as SyncLocalRole,
  SyncMutationResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncRecordSet,
  ShareRole as SyncShareRole,
  TreeManifestItem,
  TreeParentChildRelationshipRecordWire,
  TreeSnapshotResponse,
} from "../sync/types"
import type { NormalizedRelationships, PersonIdentity } from "../types"
import { clearDirty, dirtyToken, snapshotDirty, stampAndEnqueue } from "./dirty"
import {
  loadPersistedStore,
  type PersistedConflict,
  type PersistedOperationConflict,
  type PersistedPendingMutation,
  type PersistedStore,
  savePersistedStore,
} from "./persistence"
import {
  acknowledgeApplied,
  applyAliases,
  applyRemote,
  recordTombstone,
  sharedRemoteRecords,
} from "./remote"
import {
  blockedChangesForTree,
  buildPushWires,
  dirtyBatchKey,
  emptyDirtyState,
  firstPendingOperation,
  hasAcknowledgedIds,
  isStoredPhotoMarker,
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_BATCH_RECORDS,
  newId,
  now,
  operationExceedsRecordLimits,
  persistableDirty,
  pullRecordSet,
  RECORD_COLLECTIONS,
  recordSetValue,
  restoredDirty,
  STORED_PHOTO_MARKER,
  takeDirtyBatch,
  treeMemberKey,
  treeParentChildRelationshipKey,
  treeUnionKey,
  valueFor,
} from "./state-internals"
import {
  fetchFullPull,
  fetchTreeManifest,
  fetchTreeSnapshot,
} from "./sync-transport"

// Re-export stateless helpers so the barrel and sibling modules can keep
// importing them from "./state".
export {
  applyRemote,
  blockedChangesForTree,
  buildPushWires,
  clearDirty,
  fetchFullPull,
  fetchTreeManifest,
  fetchTreeSnapshot,
  isStoredPhotoMarker,
  newId,
  now,
  snapshotDirty,
  stampAndEnqueue,
  takeDirtyBatch,
  treeMemberKey,
  treeParentChildRelationshipKey,
  treeUnionKey,
}

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
// Reactive store (Zustand). Mirrors the engine's reactive singletons so React
// subscribes via selectors. The module-scoped `let` bindings below remain the
// source of truth; `notifyListeners` pushes their current values here, and
// subscribers re-render only when their selected slice actually changes
// (Object.is per selector), matching the previous `useSyncExternalStore` model.
// ---------------------------------------------------------------------------

type ReactiveState = {
  state: GlobalState
  hydrated: boolean
  syncStatus: SyncStatus
  freshlyLoadedTrees: Set<string>
  syncConflicts: PersistedConflict[]
  operationConflicts: PersistedOperationConflict[]
  ancestorTreeLinks: Map<string, Map<string, string>>
  blockedChangesVersion: number
}

const useStore = create<ReactiveState>(() => ({
  state: emptyState(),
  hydrated: false,
  syncStatus: "saved" as SyncStatus,
  freshlyLoadedTrees: new Set(),
  syncConflicts: [],
  operationConflicts: [],
  ancestorTreeLinks: new Map(),
  blockedChangesVersion: 0,
}))

// ---------------------------------------------------------------------------
// Per-record dirty tracking and normalized sync.
// ---------------------------------------------------------------------------

let state = emptyState()
export let dirtyState = emptyDirtyState()
export let remoteTombstoneClocks = emptyTombstoneClocks()
let nextRevision = 1
/** Bump and return the next optimistic-concurrency revision. Extracted modules
 *  can't reassign the imported `nextRevision` binding, so they bump via this. */
export function bumpRevision(): number {
  return nextRevision++
}
let storeGeneration = 0
let pushInFlight: Promise<void> | undefined
let pushInFlightGeneration = -1
let conflictResolutionInFlight: Promise<unknown> | undefined
const treeSyncInFlight = new Map<string, Promise<void>>()
const treeFreshSyncInFlight = new Map<string, Promise<void>>()
let deviceId = newId()
export const storeInstanceId = newId()
const mutationIdsByBatch = new Map<string, string>()
export const clearedDirtyTokens = new Set<string>()
export let pendingMutation: PersistedPendingMutation | undefined
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
 * Display-only hints mapping each source tree's people to their earliest
 * ancestor-family tree. Populated from tree snapshots so the "ancestor family"
 * card label can render before every related tree is loaded. Not synced and not
 * part of the normalized graph — `projectTree` never reads it, so it cannot
 * leak partial membership into a tree's projection.
 */
const emptyAncestorTreeLinks = new Map<string, string>()
let ancestorTreeLinks = new Map<string, Map<string, string>>()

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

type UpdateOptions = { remote?: boolean }

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
  useStore.setState({
    state,
    hydrated,
    syncStatus,
    freshlyLoadedTrees,
    syncConflicts,
    operationConflicts,
    ancestorTreeLinks,
    blockedChangesVersion,
  })
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

export type DirtyIds = Partial<Record<DirtyCollection, Iterable<string>>>

/** Clear acknowledgements only when the shipped revision is still current. */
function hasNewerDirtyRecords(shipped: DirtyState): boolean {
  return RECORD_COLLECTIONS.some((collection) =>
    [...dirtyState[collection]].some(([id, current]) => {
      const sent = shipped[collection].get(id)
      return !sent || sent.revision !== current.revision
    }),
  )
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
  const wasFreshlyLoaded = freshlyLoadedTrees.has(snapshot.tree.id)
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
  const nextLinks = new Map(ancestorTreeLinks)
  const linksForTree = snapshot.partial
    ? new Map(nextLinks.get(snapshot.tree.id))
    : new Map<string, string>()
  if (snapshot.partial) {
    for (const person of snapshot.records.persons) {
      linksForTree.delete(person.id)
    }
  }
  for (const link of snapshot.ancestorTrees ?? []) {
    linksForTree.set(link.personId, link.treeId)
  }
  nextLinks.set(snapshot.tree.id, linksForTree)
  ancestorTreeLinks = nextLinks
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
  if (!wasFreshlyLoaded) {
    freshlyLoadedTrees.add(snapshot.tree.id)
    notifyListeners()
  }
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

export function getAncestorTreeLinks(treeId: string): Map<string, string> {
  return ancestorTreeLinks.get(treeId) ?? emptyAncestorTreeLinks
}

export function subscribe(listener: () => void): () => void {
  return useStore.subscribe(listener)
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

export function useGraph(): GlobalState {
  return useStore((selector) => selector.state)
}

export function useAncestorTreeLinks(treeId: string): Map<string, string> {
  return useStore(
    (selector) =>
      selector.ancestorTreeLinks.get(treeId) ?? emptyAncestorTreeLinks,
  )
}

export function useHydrated(): boolean {
  return useStore((selector) => selector.hydrated)
}

/**
 * True once the tree has received a fresh server snapshot during the current
 * store generation (i.e. `applyTreeSnapshot` has run for it this session).
 * Used to hold the tree view on its loading state until the first visible
 * frame is the authoritative server state, not stale persisted data.
 */
export function useTreeFreshlyLoaded(treeId: string): boolean {
  return useStore((selector) => selector.freshlyLoadedTrees.has(treeId))
}

export function isTreeFreshlyLoaded(treeId: string): boolean {
  return freshlyLoadedTrees.has(treeId)
}

export function useSyncStatus(): SyncStatus {
  return useStore((selector) => selector.syncStatus)
}

export function getSyncStatus(): SyncStatus {
  return syncStatus
}

export function hasBlockedChanges(treeId: string): boolean {
  return blockedChangesForTree(state, dirtyState, treeId).length > 0
}

export function useSyncConflictCount(): number {
  return useStore((selector) => selector.syncConflicts.length)
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
  useStore((selector) => selector.blockedChangesVersion)
  return getBlockedChangesSnapshot(treeId)
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
