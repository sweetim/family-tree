import { useSyncExternalStore } from "react"
import type {
  ParentChildRelationshipWire,
  PersonPushWire,
  PersonWire,
  LocalRole as SyncLocalRole,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  ShareRole as SyncShareRole,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreePushWire,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "../sync/types"
import type { NormalizedRelationships, PersonIdentity } from "../types"

export type ShareRole = SyncShareRole
export type LocalRole = SyncLocalRole

export type TreeMeta = {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  ownerId?: string
  ownerEmail?: string | null
  role?: LocalRole
}

export type GlobalState = NormalizedRelationships & {
  persons: Record<string, PersonIdentity>
  index: TreeMeta[]
}

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
export type DirtyRecord = { action: DirtyAction; revision: number }
export type DirtyMap = Map<string, DirtyRecord>
export type DirtyState = Record<DirtyCollection, DirtyMap>
type TombstoneClocks = Record<DirtyCollection, Map<string, string>>

const EPOCH = "1970-01-01T00:00:00.000Z"
const STORED_PHOTO_MARKER = "stored-photo"
const MAX_SYNC_BATCH_RECORDS = 1_000
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

function markDirty(
  collection: DirtyCollection,
  id: string,
  action: DirtyAction,
): void {
  dirtyState[collection].set(id, { action, revision: nextRevision++ })
}

function stampRecordMap<T extends { updatedAt: string }>(
  previous: Record<string, T>,
  next: Record<string, T>,
  collection: Exclude<DirtyCollection, "persons" | "trees">,
  now: string,
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
    markDirty(collection, id, "upsert")
  }
  for (const id of Object.keys(previous)) {
    if (!next[id]) markDirty(collection, id, "delete")
  }
  return stamped
}

/** Stamp and enqueue only the normalized records whose object references changed. */
export function stampAndEnqueue(
  previous: GlobalState,
  next: GlobalState,
): GlobalState {
  if (previous === next) return next
  const now = new Date().toISOString()

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
      markDirty("persons", id, "upsert")
    }
    for (const id of Object.keys(previous.persons)) {
      if (!next.persons[id]) markDirty("persons", id, "delete")
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
      markDirty("trees", tree.id, "upsert")
    }
    const nextIds = new Set(next.index.map((tree) => tree.id))
    for (const tree of previous.index) {
      if (!nextIds.has(tree.id)) markDirty("trees", tree.id, "delete")
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
    ),
    unions: stampRecordMap(previous.unions, next.unions, "unions", now),
    unionEvents: stampRecordMap(
      previous.unionEvents,
      next.unionEvents,
      "unionEvents",
      now,
    ),
    treeUnions: stampRecordMap(
      previous.treeUnions,
      next.treeUnions,
      "treeUnions",
      now,
    ),
    parentChildRelationships: stampRecordMap(
      previous.parentChildRelationships,
      next.parentChildRelationships,
      "parentChildRelationships",
      now,
    ),
    treeParentChildRelationships: stampRecordMap(
      previous.treeParentChildRelationships,
      next.treeParentChildRelationships,
      "treeParentChildRelationships",
      now,
    ),
  }
}

type UpdateOptions = { remote?: boolean }

const listeners = new Set<() => void>()
let hydrated = false
let notificationsSuppressed = false

export function update(
  updater: (previous: GlobalState) => GlobalState,
  options?: UpdateOptions,
): void {
  const previous = state
  const next = updater(previous)
  if (next === previous) return
  state = options?.remote ? next : stampAndEnqueue(previous, next)
  if (!notificationsSuppressed) {
    for (const listener of listeners) listener()
  }
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

export function takeDirtyBatch(
  source: DirtyState,
  maximumRecords: number,
): DirtyState {
  const batch = emptyDirtyState()
  let remaining = maximumRecords
  for (const collection of RECORD_COLLECTIONS) {
    if (remaining === 0) break
    for (const [id, record] of source[collection]) {
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
        dirtyState[collection].delete(id)
      }
    }
  }
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
      persons.push({ id, updatedAt: now, deletedAt: now })
    } else {
      persons.push({
        id,
        name: person.name,
        dob: person.dob,
        dod: person.dod,
        gender: person.gender,
        location: person.location,
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
      trees.push({ id, updatedAt: now, deletedAt: now })
    } else {
      trees.push({
        id,
        name: tree.name,
        createdAt: tree.createdAt,
        updatedAt: tree.updatedAt ?? now,
      })
    }
  }

  const treeMembers: TreeMemberWire[] = []
  for (const id of dirty.treeMembers.keys()) {
    const record = snapshot.treeMembers[id]
    if (actionFor(dirty.treeMembers, id) === "delete" || !record) {
      const [treeId, personId] = parseAssociationKey(id)
      treeMembers.push({ treeId, personId, updatedAt: now, deletedAt: now })
    } else treeMembers.push(record)
  }

  const unions: UnionWire[] = []
  for (const id of dirty.unions.keys()) {
    const record = snapshot.unions[id]
    unions.push(
      actionFor(dirty.unions, id) === "delete" || !record
        ? { id, updatedAt: now, deletedAt: now }
        : record,
    )
  }

  const unionEvents: UnionEventWire[] = []
  for (const id of dirty.unionEvents.keys()) {
    const record = snapshot.unionEvents[id]
    unionEvents.push(
      actionFor(dirty.unionEvents, id) === "delete" || !record
        ? { id, updatedAt: now, deletedAt: now }
        : record,
    )
  }

  const treeUnions: TreeUnionWire[] = []
  for (const id of dirty.treeUnions.keys()) {
    const record = snapshot.treeUnions[id]
    if (actionFor(dirty.treeUnions, id) === "delete" || !record) {
      const [treeId, unionId] = parseAssociationKey(id)
      treeUnions.push({ treeId, unionId, updatedAt: now, deletedAt: now })
    } else treeUnions.push(record)
  }

  const parentChildRelationships: ParentChildRelationshipWire[] = []
  for (const id of dirty.parentChildRelationships.keys()) {
    const record = snapshot.parentChildRelationships[id]
    parentChildRelationships.push(
      actionFor(dirty.parentChildRelationships, id) === "delete" || !record
        ? { id, updatedAt: now, deletedAt: now }
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

export async function fetchFullPull(): Promise<SyncPullResponse> {
  const response = await fetch(`/api/sync?since=${encodeURIComponent(EPOCH)}`, {
    credentials: "include",
  })
  if (!response.ok) throw new Error(`pull failed: ${response.status}`)
  return (await response.json()) as SyncPullResponse
}

async function runPushLoop(generation: number): Promise<void> {
  let authoritativePullNeeded = false
  while (generation === storeGeneration) {
    const pending = snapshotDirty()
    let maximumRecords = MAX_SYNC_BATCH_RECORDS
    let dirty = takeDirtyBatch(pending, maximumRecords)
    let request = buildPushWires(state, dirty, new Date().toISOString())
    if (
      RECORD_COLLECTIONS.every((collection) => request[collection].length === 0)
    ) {
      return
    }
    let serializedRequest = JSON.stringify(request)
    while (
      new TextEncoder().encode(serializedRequest).byteLength
        > MAX_SYNC_BATCH_BYTES
      && maximumRecords > 1
    ) {
      maximumRecords = Math.max(1, Math.floor(maximumRecords / 2))
      dirty = takeDirtyBatch(pending, maximumRecords)
      request = buildPushWires(state, dirty, new Date().toISOString())
      serializedRequest = JSON.stringify(request)
    }

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: serializedRequest,
      })
      if (!response.ok) throw new Error(`push failed: ${response.status}`)
      const result = (await response.json()) as SyncPushResponse
      if (generation !== storeGeneration) return
      clearDirty(result.applied, dirty)
      clearDirty(result.skipped, dirty)
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
      return
    }
  }
}

function pushDirty(): Promise<void> {
  if (pushInFlight && pushInFlightGeneration === storeGeneration) {
    return pushInFlight
  }
  const generation = storeGeneration
  const promise = runPushLoop(generation).finally(() => {
    if (pushInFlight === promise) pushInFlight = undefined
  })
  pushInFlight = promise
  pushInFlightGeneration = generation
  return promise
}

type RemoteWire = { updatedAt: string; deletedAt?: string }

function tombstoneBlocks(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
): boolean {
  return (remoteTombstoneClocks[collection].get(id) ?? "") >= updatedAt
}

function recordTombstone(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
): void {
  const current = remoteTombstoneClocks[collection].get(id)
  if (!current || current < updatedAt) {
    remoteTombstoneClocks[collection].set(id, updatedAt)
  }
}

function mergeRemoteRecords<
  T extends { updatedAt: string },
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
    if (tombstoneBlocks(collection, id, wire.updatedAt)) continue
    if (dirtyState[collection].get(id)?.action === "delete") continue
    if (
      local
      && (wire.deletedAt
        ? local.updatedAt > wire.updatedAt
        : local.updatedAt >= wire.updatedAt)
    ) {
      continue
    }
    if (result === records) result = { ...records }
    if (wire.deletedAt) {
      recordTombstone(collection, id, wire.updatedAt)
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
          if (tombstoneBlocks("persons", wire.id, wire.updatedAt)) continue
          if (dirtyState.persons.get(wire.id)?.action === "delete") continue
          if (
            local
            && ("deletedAt" in wire
              ? (local.updatedAt ?? "") > wire.updatedAt
              : (local.updatedAt ?? "") >= wire.updatedAt)
          ) {
            continue
          }
          if (persons === previous.persons) persons = { ...persons }
          if ("deletedAt" in wire) {
            recordTombstone("persons", wire.id, wire.updatedAt)
            delete persons[wire.id]
          } else {
            persons[wire.id] = {
              id: wire.id,
              name: wire.name,
              dob: wire.dob,
              dod: wire.dod,
              gender: wire.gender,
              location: wire.location,
              photo: wire.hasPhoto ? STORED_PHOTO_MARKER : wire.photo,
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
          if (tombstoneBlocks("trees", wire.id, wire.updatedAt)) continue
          if ("deletedAt" in wire) {
            if (local && (local.updatedAt ?? "") > wire.updatedAt) continue
          } else if (local) {
            const role = wire.role ?? local.role
            const ownerEmail =
              wire.ownerEmail !== undefined ? wire.ownerEmail : local.ownerEmail
            const accessChanged =
              role !== local.role || ownerEmail !== local.ownerEmail
            if ((local.updatedAt ?? "") > wire.updatedAt) {
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
            recordTombstone("trees", wire.id, wire.updatedAt)
            deletedTrees.set(wire.id, wire.updatedAt)
            byId.delete(wire.id)
          } else {
            const replacement: TreeMeta = {
              id: wire.id,
              name: wire.name,
              createdAt: wire.createdAt,
              updatedAt: wire.updatedAt,
              ownerId: wire.ownerId,
              ownerEmail: wire.ownerEmail ?? local?.ownerEmail,
              role: wire.role ?? local?.role,
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
  const previousTombstoneIds = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...remoteTombstoneClocks[collection].keys()],
    ]),
  ) as Record<DirtyCollection, string[]>
  const pendingDeleteIds = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...dirtyState[collection]]
        .filter(([, record]) => record.action === "delete")
        .map(([id]) => id),
    ]),
  ) as Record<DirtyCollection, string[]>
  notificationsSuppressed = true
  try {
    state = emptyState()
    dirtyState = emptyDirtyState()
    remoteTombstoneClocks = emptyTombstoneClocks()
    nextRevision = 1
    for (const collection of RECORD_COLLECTIONS) {
      for (const id of pendingDeleteIds[collection]) {
        markDirty(collection, id, "delete")
      }
    }
    applyRemote(pull.own)
    for (const shared of pull.shared) applyRemote(sharedRemoteRecords(shared))
    for (const id of new Set([
      ...Object.keys(previous.persons),
      ...previousTombstoneIds.persons,
    ])) {
      if (!state.persons[id]) recordTombstone("persons", id, pull.serverTime)
    }
    const nextTreeIds = new Set(state.index.map((tree) => tree.id))
    for (const id of new Set([
      ...previous.index.map((tree) => tree.id),
      ...previousTombstoneIds.trees,
    ])) {
      if (!nextTreeIds.has(id)) {
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
        if (!state[collection][id]) {
          recordTombstone(collection, id, pull.serverTime)
        }
      }
    }
  } finally {
    notificationsSuppressed = false
  }
  for (const listener of listeners) listener()
}

// ---------------------------------------------------------------------------
// Store lifecycle helpers.
// ---------------------------------------------------------------------------

export function getGraph(): GlobalState {
  return state
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
  for (const listener of listeners) listener()
}

export function resetStore(): void {
  storeGeneration++
  state = emptyState()
  dirtyState = emptyDirtyState()
  remoteTombstoneClocks = emptyTombstoneClocks()
  nextRevision = 1
  setHydrated(false)
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated)
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
