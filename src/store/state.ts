import type {
  RequestableAncestorLink,
  LocalRole as SyncLocalRole,
  SyncPullResponse,
  SyncPushRequest,
  ShareRole as SyncShareRole,
  TreeManifestItem,
  TreeSnapshotResponse,
} from "../sync/types"
import type { NormalizedRelationships, PersonIdentity } from "../types"
import {
  clearBlockedChangesCache,
  getBlockedChangesSnapshot,
  getOperationConflicts,
  getSyncConflicts,
  hydrateConflicts,
  resetConflicts,
} from "./conflicts"
import {
  getDeviceId,
  hydrateCoordinator,
  mutationIdsByBatch,
  pushDirty,
  resetCoordinator,
} from "./coordinator"
import {
  clearDirty,
  dirtyState,
  hydrateOutbox,
  replaceDirtyState,
  resetOutbox,
  setNextRevision,
  snapshotDirty,
  stampAndEnqueue,
} from "./dirty"
import type { PersistedStore } from "./persistence"
import {
  persistCurrentStore,
  resetPersistenceCoordinator,
  schedulePersistence,
} from "./persistence-coordinator"
import { applyRemote, recordTombstone, sharedRemoteRecords } from "./remote"
import { useStore } from "./state-hooks"
import {
  ancestorTreeLinksFor,
  blockedChangesForTree,
  buildPushWires,
  emptyDirtyState,
  emptyState,
  isStoredPhotoMarker,
  newId,
  now,
  RECORD_COLLECTIONS,
  requestableAncestorLinksFor,
  takeDirtyBatch,
  treeMemberKey,
  treeParentChildRelationshipKey,
  treeUnionKey,
} from "./state-internals"
import {
  fetchFullPull,
  fetchTreeManifest,
  fetchTreeSnapshot,
} from "./sync-transport"

// Re-export the public conflict API so the barrel can keep importing it from
// "./state". The owned state and logic live in `./conflicts`.
export { resolveBlockedOperation, resolveNextSyncConflict } from "./conflicts"
// Re-export the public sync API; the coordinator owns push/tree-sync.
export {
  synchronizePending,
  synchronizeTree,
  synchronizeTreeFresh,
} from "./coordinator"
export { restorePersistentStore } from "./persistence-coordinator"
// Re-export the React hooks so the barrel and sibling modules can keep
// importing them from "./state". The hook implementations live in
// `./state-hooks`; this module only pulls in `useStore` for `notifyListeners`,
// `subscribe`, and `useBlockedChanges`, keeping the runtime dependency
// one-directional (state.ts -> state-hooks).
export {
  useAncestorTreeLinks,
  useGraph,
  useHydrated,
  useParentChildRelationships,
  usePersons,
  useRequestableAncestorLinks,
  useSyncConflictCount,
  useSyncStatus,
  useTreeFreshlyLoaded,
  useTreeMembers,
  useTreeParentChildRelationships,
  useTrees,
  useTreeUnions,
  useUnionEvents,
  useUnions,
} from "./state-hooks"
// Re-export stateless helpers so the barrel and sibling modules can keep
// importing them from "./state".
export {
  applyRemote,
  blockedChangesForTree,
  buildPushWires,
  clearDirty,
  emptyState,
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

// Zustand owns the committed graph. A full pull buffers its intermediate graph
// here so remote replay remains atomic from subscribers' perspective.
let pendingGraph: GlobalState | undefined
export let remoteTombstoneClocks = emptyTombstoneClocks()
let storeGeneration = 0

/**
 * Display-only hints mapping each source tree's people to their earliest
 * ancestor-family tree. Populated from tree snapshots so the "ancestor family"
 * card label can render before every related tree is loaded. Not synced and not
 * part of the normalized graph — `projectTree` never reads it, so it cannot
 * leak partial membership into a tree's projection.
 */
let ancestorTreeLinks = new Map<string, Map<string, string>>()

/**
 * Inaccessible ancestor-family trees per snapshot tree, keyed by person id,
 * so a card can offer a "request access" badge. Carries the tree name since
 * the client has no index entry for trees it can't access. Mirrors
 * {@link ancestorTreeLinks} but for trees the viewer lacks a role on.
 */
let requestableAncestorLinks = new Map<
  string,
  Map<string, RequestableAncestorLink>
>()

/**
 * Tree ids that have received a fresh server snapshot during the current store
 * generation. Unlike `TreeMeta.loaded` (which is persisted and so can already
 * be true on reload), this set only fills as `applyTreeSnapshot` runs this
 * session, so the tree view can hold its loading state until the first frame
 * reflects the authoritative server data instead of stale persisted state.
 */
let freshlyLoadedTrees = new Set<string>()

type UpdateOptions = { remote?: boolean }

let hydrated = false
let notificationsSuppressed = false
let syncStatus: SyncStatus = "saved"
let blockedChangesVersion = 0

export function notifyListeners(): void {
  const graph = getSnapshot()
  blockedChangesVersion++
  clearBlockedChangesCache()
  useStore.setState({
    state: graph,
    hydrated,
    syncStatus,
    freshlyLoadedTrees,
    syncConflicts: getSyncConflicts(),
    operationConflicts: getOperationConflicts(),
    ancestorTreeLinks,
    requestableAncestorLinks,
    blockedChangesVersion,
  })
  if (pendingGraph === graph) pendingGraph = undefined
}

export function setSyncStatus(value: SyncStatus): void {
  if (syncStatus === value) return
  syncStatus = value
  notifyListeners()
}

export function statusFromDirtyState(): SyncStatus {
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

/** Current store generation; bumped on `resetStore` to cancel in-flight work. */
export function getStoreGeneration(): number {
  return storeGeneration
}

/** Version counter for the blocked-changes cache, bumped on each notification. */
export function getBlockedChangesVersion(): number {
  return blockedChangesVersion
}

export function update(
  updater: (previous: GlobalState) => GlobalState,
  options?: UpdateOptions,
): void {
  const previous = getSnapshot()
  const next = updater(previous)
  if (next === previous) return
  pendingGraph = options?.remote ? next : stampAndEnqueue(previous, next)
  if (!notificationsSuppressed) {
    notifyListeners()
  }
  schedulePersistence()
  if (!options?.remote) setSyncStatus("saving")
  if (!options?.remote) void pushDirty()
}

export function getSnapshot(): GlobalState {
  return pendingGraph ?? useStore.getState().state
}

export type DirtyIds = Partial<Record<DirtyCollection, Iterable<string>>>

function treeSignature(tree: TreeMeta): string {
  return JSON.stringify(tree, Object.keys(tree).sort())
}

/** Structural equality for the tree index. The periodic manifest poll rebuilds
 *  a fresh `index` array even when nothing changed, which would churn every
 *  narrow selector subscribing to `index` (and thus every `PersonNode`). When
 *  the rebuild is byte-identical we return `previous` so `update` no-ops. */
function indexEqual(previous: TreeMeta[], next: TreeMeta[]): boolean {
  if (previous.length !== next.length) return false
  for (let position = 0; position < next.length; position++) {
    const before = previous[position]
    const after = next[position]
    if (!before || !after) return false
    if (before.id !== after.id) return false
    if (treeSignature(before) !== treeSignature(after)) return false
  }
  return true
}

export function applyTreeManifest(manifest: TreeManifestItem[]): void {
  const remoteIds = new Set(manifest.map((tree) => tree.id))
  const pendingTreeIds = new Set(dirtyState.trees.keys())
  update(
    (previous) => {
      const localById = new Map(previous.index.map((tree) => [tree.id, tree]))
      const nextIndex: TreeMeta[] = [
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
      ]
      if (indexEqual(previous.index, nextIndex)) return previous
      return { ...previous, index: nextIndex }
    },
    { remote: true },
  )
}

export async function deleteTreeOnServer(treeId: string): Promise<void> {
  const generation = storeGeneration
  const tree = getSnapshot().index.find((candidate) => candidate.id === treeId)
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
      deviceId: getDeviceId(),
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
  const nextRequestable = new Map(requestableAncestorLinks)
  const requestableForTree = snapshot.partial
    ? new Map(nextRequestable.get(snapshot.tree.id))
    : new Map<string, RequestableAncestorLink>()
  if (snapshot.partial) {
    for (const person of snapshot.records.persons) {
      requestableForTree.delete(person.id)
    }
  }
  for (const link of snapshot.requestableAncestors ?? []) {
    requestableForTree.set(link.personId, link)
  }
  nextRequestable.set(snapshot.tree.id, requestableForTree)
  requestableAncestorLinks = nextRequestable
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

/** Replace the complete local graph from an authoritative epoch pull. */
export function applyFullPull(pull: SyncPullResponse): void {
  const previous = getSnapshot()
  const pendingDirty = snapshotDirty()
  const previousTombstoneIds = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...remoteTombstoneClocks[collection].keys()],
    ]),
  ) as Record<DirtyCollection, string[]>
  notificationsSuppressed = true
  try {
    pendingGraph = emptyState()
    replaceDirtyState(emptyDirtyState())
    ancestorTreeLinks = new Map()
    requestableAncestorLinks = new Map()
    remoteTombstoneClocks = emptyTombstoneClocks()
    applyRemote(pull.own)
    for (const shared of pull.shared) applyRemote(sharedRemoteRecords(shared))
    const next = getSnapshot()
    for (const id of new Set([
      ...Object.keys(previous.persons),
      ...previousTombstoneIds.persons,
    ])) {
      if (!next.persons[id] && !pendingDirty.persons.has(id)) {
        recordTombstone("persons", id, pull.serverTime)
      }
    }
    const nextTreeIds = new Set(next.index.map((tree) => tree.id))
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
        if (!next[collection][id] && !pendingDirty[collection].has(id)) {
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

    const serverTrees = new Map(next.index.map((tree) => [tree.id, tree]))
    const localTrees = new Map(previous.index.map((tree) => [tree.id, tree]))
    for (const [id, dirty] of pendingDirty.trees) {
      const position = next.index.findIndex((tree) => tree.id === id)
      if (dirty.action === "delete") {
        if (position >= 0) next.index.splice(position, 1)
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
      if (position >= 0) next.index[position] = replayed
      else next.index.push(replayed)
    }
    next.persons = replayRecords(
      next.persons,
      previous.persons,
      pendingDirty.persons,
    )
    next.treeMembers = replayRecords(
      next.treeMembers,
      previous.treeMembers,
      pendingDirty.treeMembers,
    )
    next.unions = replayRecords(
      next.unions,
      previous.unions,
      pendingDirty.unions,
    )
    next.unionEvents = replayRecords(
      next.unionEvents,
      previous.unionEvents,
      pendingDirty.unionEvents,
    )
    next.treeUnions = replayRecords(
      next.treeUnions,
      previous.treeUnions,
      pendingDirty.treeUnions,
    )
    next.parentChildRelationships = replayRecords(
      next.parentChildRelationships,
      previous.parentChildRelationships,
      pendingDirty.parentChildRelationships,
    )
    next.treeParentChildRelationships = replayRecords(
      next.treeParentChildRelationships,
      previous.treeParentChildRelationships,
      pendingDirty.treeParentChildRelationships,
    )
    replaceDirtyState(pendingDirty)
    setNextRevision(
      Math.max(
        0,
        ...RECORD_COLLECTIONS.flatMap((collection) =>
          [...dirtyState[collection].values()].map((record) => record.revision),
        ),
      ) + 1,
    )
  } finally {
    notificationsSuppressed = false
  }
  notifyListeners()
}

// ---------------------------------------------------------------------------
// Store lifecycle helpers.
// ---------------------------------------------------------------------------

export function getGraph(): GlobalState {
  return getSnapshot()
}

export function getAncestorTreeLinks(treeId: string): Map<string, string> {
  return ancestorTreeLinksFor(ancestorTreeLinks, treeId)
}

export function getRequestableAncestorLinks(
  treeId: string,
): Map<string, RequestableAncestorLink> {
  return requestableAncestorLinksFor(requestableAncestorLinks, treeId)
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
  pendingGraph = emptyState()
  resetOutbox()
  remoteTombstoneClocks = emptyTombstoneClocks()
  ancestorTreeLinks = new Map()
  requestableAncestorLinks = new Map()
  freshlyLoadedTrees = new Set()
  resetCoordinator()
  resetConflicts()
  resetPersistenceCoordinator()
  if (hydrated) setHydrated(false)
  else notifyListeners()
}

/** Apply a loaded persistent snapshot as one committed graph/unit update. */
export function hydratePersistedStore(persisted: PersistedStore): void {
  pendingGraph = persisted.state
  hydrateOutbox(persisted)
  hydrateCoordinator(persisted)
  hydrateConflicts(persisted)
  syncStatus = RECORD_COLLECTIONS.some((collection) =>
    [...dirtyState[collection].values()].some((record) => record.blocked),
  )
    ? "conflict"
    : RECORD_COLLECTIONS.some((collection) => dirtyState[collection].size > 0)
      ? "saving"
      : "saved"
  notifyListeners()
}

export function isTreeFreshlyLoaded(treeId: string): boolean {
  return freshlyLoadedTrees.has(treeId)
}

export function getSyncStatus(): SyncStatus {
  return syncStatus
}

export function hasBlockedChanges(treeId: string): boolean {
  return blockedChangesForTree(getSnapshot(), dirtyState, treeId).length > 0
}

/** Server conflict reasons are protocol values; the panel shows people text. */
export function useBlockedChanges(treeId: string): BlockedChange[] {
  useStore((selector) => selector.blockedChangesVersion)
  return getBlockedChangesSnapshot(treeId)
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
