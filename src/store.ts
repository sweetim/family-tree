import { useCallback, useMemo, useSyncExternalStore } from "react"
import type {
  ParentChildRelationshipWire,
  PersonWire,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "./sync/types"
import {
  canonicalPersonPair,
  descendantsOf,
  type FamilyData,
  type Gender,
  type NormalizedRelationships,
  type ParentChildRelationship,
  type ParentChildRelationshipType,
  type ParentLink,
  type Person,
  type PersonIdentity,
  type PersonInput,
  projectTree,
  projectTrees,
  type Relationship,
  type Union,
  type UnionEvent,
  unionIsCurrent,
} from "./types"

export type ShareRole = "viewer" | "editor"
export type LocalRole = "owner" | ShareRole

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

function newId(): string {
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
// Legacy projected JSON import support.
// ---------------------------------------------------------------------------

type LegacyPerson = Partial<{
  id: string
  name: string
  dob: string
  dod: string
  gender: Gender
  location: string
  photo: string
  parentIds: string[]
  spouseId: string
  parents: ParentLink[]
  spouseIds: string[]
  marriageDates: Record<string, string>
}>

const ASCII_ID = /^[\x21-\x7e]+$/
const PARENT_RELATIONSHIP_TYPES = new Set<ParentChildRelationshipType>([
  "biological",
  "adoptive",
  "foster",
  "guardian",
  "step",
])

function isExactIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return day <= (daysInMonth[month - 1] ?? 0)
}

export function validateImportedFamily(data: FamilyData): FamilyData {
  const personIds = new Set(Object.keys(data))
  for (const [recordId, value] of Object.entries(data)) {
    const person = value as Person | null | undefined
    if (!person || typeof person !== "object") {
      throw new Error("Every imported member must be an object")
    }
    if (
      !ASCII_ID.test(recordId)
      || typeof person.id !== "string"
      || person.id !== recordId
      || !ASCII_ID.test(person.id)
    ) {
      throw new Error("Imported member IDs must be matching nonempty ASCII")
    }
    if (typeof person.name !== "string") {
      throw new Error("Every imported member must have a name")
    }
    if (!Array.isArray(person.parents) || person.parents.length > 2) {
      throw new Error("Imported members may have at most two parents")
    }
    if (!Array.isArray(person.spouseIds)) {
      throw new Error("Imported spouse IDs must be an array")
    }
    if (
      !person.marriageDates
      || typeof person.marriageDates !== "object"
      || Array.isArray(person.marriageDates)
    ) {
      throw new Error("Imported marriage dates must be an object")
    }

    const parentIds = new Set<string>()
    for (const parent of person.parents) {
      if (
        !parent
        || typeof parent !== "object"
        || typeof parent.id !== "string"
        || !personIds.has(parent.id)
        || parent.id === person.id
        || parentIds.has(parent.id)
      ) {
        throw new Error("Imported parent references must be unique members")
      }
      if (parent.adopted !== undefined && typeof parent.adopted !== "boolean") {
        throw new Error("Imported adopted values must be boolean")
      }
      if (
        parent.type !== undefined
        && !PARENT_RELATIONSHIP_TYPES.has(parent.type)
      ) {
        throw new Error("Imported parent relationship type is invalid")
      }
      if (
        (parent.adopted === true
          && parent.type !== undefined
          && parent.type !== "adoptive")
        || (parent.adopted === false && parent.type === "adoptive")
      ) {
        throw new Error("Imported adopted value conflicts with parent type")
      }
      parentIds.add(parent.id)
    }

    const spouseIds = new Set<string>()
    for (const spouseId of person.spouseIds) {
      if (
        typeof spouseId !== "string"
        || !personIds.has(spouseId)
        || spouseId === person.id
        || spouseIds.has(spouseId)
      ) {
        throw new Error("Imported spouse references must be unique members")
      }
      spouseIds.add(spouseId)
    }
    for (const [spouseId, marriageDate] of Object.entries(
      person.marriageDates,
    )) {
      if (
        !spouseIds.has(spouseId)
        || typeof marriageDate !== "string"
        || !isExactIsoDate(marriageDate)
      ) {
        throw new Error("Imported marriage dates must reference a spouse")
      }
    }
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (personId: string): void => {
    if (visiting.has(personId)) {
      throw new Error("Imported parent relationships must not contain cycles")
    }
    if (visited.has(personId)) return
    visiting.add(personId)
    for (const parent of data[personId]?.parents ?? []) visit(parent.id)
    visiting.delete(personId)
    visited.add(personId)
  }
  for (const personId of personIds) visit(personId)
  return data
}

function migrateLegacy(data: Record<string, LegacyPerson>): FamilyData {
  const family: FamilyData = {}
  for (const person of Object.values(data)) {
    if (!person || typeof person.id !== "string") continue
    family[person.id] = {
      id: person.id,
      name: person.name ?? "",
      dob: person.dob,
      dod: person.dod,
      gender: person.gender,
      location: person.location,
      photo: person.photo,
      parents: Array.isArray(person.parentIds)
        ? person.parentIds.map((id) => ({ id }))
        : (person.parents ?? []),
      spouseIds: person.spouseId ? [person.spouseId] : (person.spouseIds ?? []),
      marriageDates: person.marriageDates ?? {},
    }
  }
  return family
}

export function normalizeImport(data: Record<string, unknown>): FamilyData {
  if (Array.isArray(data)) throw new Error("Imported family must be an object")
  const looksLegacy = Object.values(data).some((person) => {
    const candidate = person as LegacyPerson | null | undefined
    return (
      Array.isArray(candidate?.parentIds) || candidate?.spouseId !== undefined
    )
  })
  const family = looksLegacy
    ? migrateLegacy(data as Record<string, LegacyPerson>)
    : (Object.fromEntries(
        Object.entries(data).map(([id, value]) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Every imported member must be an object")
          }
          const person = value as Person
          return [id, { ...person, marriageDates: person.marriageDates ?? {} }]
        }),
      ) as FamilyData)
  return validateImportedFamily(family)
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

function update(
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
  const persons: PersonWire[] = []
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
        photo: person.photo,
        updatedAt: person.updatedAt ?? now,
        ownerId: person.ownerId,
      })
    }
  }

  const trees: TreeWire[] = []
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
        ownerId: tree.ownerId ?? "",
        ownerEmail: tree.ownerEmail,
        role: tree.role,
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
    const dirty = snapshotDirty()
    const request = buildPushWires(state, dirty, new Date().toISOString())
    if (
      RECORD_COLLECTIONS.every((collection) => request[collection].length === 0)
    ) {
      return
    }

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
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

export function syncPendingChanges(): Promise<void> {
  return pushDirty()
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
              photo: wire.photo,
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
  notificationsSuppressed = true
  try {
    state = emptyState()
    dirtyState = emptyDirtyState()
    remoteTombstoneClocks = emptyTombstoneClocks()
    nextRevision = 1
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
// Store lifecycle and normalized mutation helpers.
// ---------------------------------------------------------------------------

function getGraph(): GlobalState {
  return state
}

function getHydrated(): boolean {
  return hydrated
}

function subscribe(listener: () => void): () => void {
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

function now(): string {
  return new Date().toISOString()
}

function makeDraft(previous: GlobalState): GlobalState {
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

function treeIsWritable(graph: GlobalState, treeId: string): boolean {
  const tree = graph.index.find((candidate) => candidate.id === treeId)
  return !!tree && tree.role !== "viewer"
}

export function personHasWritableTree(
  graph: GlobalState,
  personId: string,
): boolean {
  return Object.values(graph.treeMembers).some(
    (member) =>
      member.personId === personId && treeIsWritable(graph, member.treeId),
  )
}

function hasMember(
  graph: GlobalState,
  treeId: string,
  personId: string,
): boolean {
  return !!graph.treeMembers[treeMemberKey(treeId, personId)]
}

function addMember(graph: GlobalState, treeId: string, personId: string): void {
  const key = treeMemberKey(treeId, personId)
  if (graph.treeMembers[key]) return
  const timestamp = now()
  graph.treeMembers[key] = {
    treeId,
    personId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function addMemberWithCurrentSpouses(
  graph: GlobalState,
  treeId: string,
  personId: string,
): void {
  addMember(graph, treeId, personId)
  for (const union of Object.values(graph.unions)) {
    if (!unionIsCurrent(union.id, graph.unionEvents)) continue
    const spouseId =
      union.firstPersonId === personId
        ? union.secondPersonId
        : union.secondPersonId === personId
          ? union.firstPersonId
          : undefined
    if (!spouseId) continue
    addMember(graph, treeId, spouseId)
    associateUnion(graph, treeId, union.id)
  }
}

function removeMember(
  graph: GlobalState,
  treeId: string,
  personId: string,
): void {
  delete graph.treeMembers[treeMemberKey(treeId, personId)]
}

function associateUnion(
  graph: GlobalState,
  treeId: string,
  unionId: string,
): void {
  const key = treeUnionKey(treeId, unionId)
  if (graph.treeUnions[key]) return
  const timestamp = now()
  graph.treeUnions[key] = {
    treeId,
    unionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function associateParentChildRelationship(
  graph: GlobalState,
  treeId: string,
  parentChildRelationshipId: string,
): void {
  const key = treeParentChildRelationshipKey(treeId, parentChildRelationshipId)
  if (graph.treeParentChildRelationships[key]) return
  const timestamp = now()
  graph.treeParentChildRelationships[key] = {
    treeId,
    parentChildRelationshipId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function unionEventsFor(graph: GlobalState, unionId: string): UnionEvent[] {
  return Object.values(graph.unionEvents).filter(
    (event) => event.unionId === unionId,
  )
}

function currentUnionForPair(
  graph: GlobalState,
  firstPersonId: string,
  secondPersonId: string,
  treeId?: string,
): Union | undefined {
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const associatedIds = treeId
    ? new Set(
        Object.values(graph.treeUnions)
          .filter((association) => association.treeId === treeId)
          .map((association) => association.unionId),
      )
    : undefined
  return Object.values(graph.unions)
    .filter(
      (union) =>
        union.firstPersonId === first
        && union.secondPersonId === second
        && (!associatedIds || associatedIds.has(union.id))
        && unionIsCurrent(union.id, graph.unionEvents),
    )
    .sort(
      (firstUnion, secondUnion) =>
        firstUnion.createdAt.localeCompare(secondUnion.createdAt)
        || firstUnion.id.localeCompare(secondUnion.id),
    )
    .at(-1)
}

function ensureMarriedEvent(graph: GlobalState, unionId: string): UnionEvent {
  const existing = unionEventsFor(graph, unionId)
    .filter((event) => event.type === "married")
    .sort(
      (first, second) =>
        first.createdAt.localeCompare(second.createdAt)
        || first.id.localeCompare(second.id),
    )
    .at(-1)
  if (existing) return existing
  const timestamp = now()
  const event: UnionEvent = {
    id: newId(),
    unionId,
    type: "married",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unionEvents[event.id] = event
  return event
}

function ensureUnion(
  graph: GlobalState,
  firstPersonId: string,
  secondPersonId: string,
): Union {
  const existing = currentUnionForPair(graph, firstPersonId, secondPersonId)
  if (existing) {
    ensureMarriedEvent(graph, existing.id)
    return existing
  }
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const timestamp = now()
  const union: Union = {
    id: newId(),
    firstPersonId: first,
    secondPersonId: second,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unions[union.id] = union
  ensureMarriedEvent(graph, union.id)
  return union
}

function parentRelationshipForPair(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
  treeId?: string,
): ParentChildRelationship | undefined {
  const associatedIds = treeId
    ? new Set(
        Object.values(graph.treeParentChildRelationships)
          .filter((association) => association.treeId === treeId)
          .map((association) => association.parentChildRelationshipId),
      )
    : undefined
  return Object.values(graph.parentChildRelationships)
    .filter(
      (relationship) =>
        relationship.parentPersonId === parentPersonId
        && relationship.childPersonId === childPersonId
        && (!associatedIds || associatedIds.has(relationship.id)),
    )
    .sort(
      (first, second) =>
        first.createdAt.localeCompare(second.createdAt)
        || first.id.localeCompare(second.id),
    )
    .at(-1)
}

function activeParentRelationships(
  graph: GlobalState,
): ParentChildRelationship[] {
  return Object.values(graph.parentChildRelationships).filter(
    (relationship) =>
      !!graph.persons[relationship.parentPersonId]
      && !!graph.persons[relationship.childPersonId],
  )
}

export function canCreateParentRelationship(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
): boolean {
  if (parentPersonId === childPersonId) return false
  if (parentRelationshipForPair(graph, parentPersonId, childPersonId)) {
    return true
  }
  const relationships = activeParentRelationships(graph)
  const parentIds = new Set(
    relationships
      .filter((relationship) => relationship.childPersonId === childPersonId)
      .map((relationship) => relationship.parentPersonId),
  )
  if (parentIds.size >= 2) return false

  const descendants = new Set<string>()
  const pending = [childPersonId]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    for (const relationship of relationships) {
      if (
        relationship.parentPersonId !== current
        || descendants.has(relationship.childPersonId)
      ) {
        continue
      }
      if (relationship.childPersonId === parentPersonId) return false
      descendants.add(relationship.childPersonId)
      pending.push(relationship.childPersonId)
    }
  }
  return true
}

function ensureParentChildRelationship(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
  type: ParentChildRelationshipType = "biological",
): ParentChildRelationship | undefined {
  const existing = parentRelationshipForPair(
    graph,
    parentPersonId,
    childPersonId,
  )
  if (existing) return existing
  if (!canCreateParentRelationship(graph, parentPersonId, childPersonId)) {
    return undefined
  }
  const timestamp = now()
  const relationship: ParentChildRelationship = {
    id: newId(),
    parentPersonId,
    childPersonId,
    type,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.parentChildRelationships[relationship.id] = relationship
  return relationship
}

function treesWithMember(
  graph: GlobalState,
  personId: string,
  excludeTreeId?: string,
): string[] {
  return graph.index
    .filter(
      (tree) =>
        tree.id !== excludeTreeId
        && treeIsWritable(graph, tree.id)
        && hasMember(graph, tree.id, personId),
    )
    .map((tree) => tree.id)
}

function treesContainingAll(
  graph: GlobalState,
  personIds: string[],
  excludeTreeId?: string,
): string[] {
  return graph.index
    .filter(
      (tree) =>
        tree.id !== excludeTreeId
        && treeIsWritable(graph, tree.id)
        && personIds.every((personId) => hasMember(graph, tree.id, personId)),
    )
    .map((tree) => tree.id)
}

function removePersonFromTreeRecords(
  graph: GlobalState,
  personId: string,
  treeId: string,
): void {
  removeMember(graph, treeId, personId)
  for (const [key, association] of Object.entries(graph.treeUnions)) {
    if (association.treeId !== treeId) continue
    const union = graph.unions[association.unionId]
    if (
      union
      && (union.firstPersonId === personId || union.secondPersonId === personId)
    ) {
      delete graph.treeUnions[key]
    }
  }
  for (const [key, association] of Object.entries(
    graph.treeParentChildRelationships,
  )) {
    if (association.treeId !== treeId) continue
    const relationship =
      graph.parentChildRelationships[association.parentChildRelationshipId]
    if (
      relationship
      && (relationship.parentPersonId === personId
        || relationship.childPersonId === personId)
    ) {
      delete graph.treeParentChildRelationships[key]
    }
  }
}

function identityFromPerson(person: Person): PersonIdentity {
  return {
    id: person.id,
    name: person.name,
    dob: person.dob,
    dod: person.dod,
    gender: person.gender,
    location: person.location,
    photo: person.photo,
  }
}

function reconcileTreeData(
  graph: GlobalState,
  treeId: string,
  data: FamilyData,
): void {
  const desiredMemberIds = new Set(Object.keys(data))
  for (const person of Object.values(data)) {
    graph.persons[person.id] = {
      ...graph.persons[person.id],
      ...identityFromPerson(person),
    }
    addMember(graph, treeId, person.id)
  }
  for (const member of Object.values(graph.treeMembers)) {
    if (member.treeId === treeId && !desiredMemberIds.has(member.personId)) {
      removePersonFromTreeRecords(graph, member.personId, treeId)
    }
  }

  const desiredUnionIds = new Set<string>()
  const seenPairs = new Set<string>()
  for (const person of Object.values(data)) {
    for (const spouseId of person.spouseIds) {
      if (!data[spouseId] || spouseId === person.id) continue
      const [firstPersonId, secondPersonId] = canonicalPersonPair(
        person.id,
        spouseId,
      )
      const pairKey = `${firstPersonId}:${secondPersonId}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      const union = ensureUnion(graph, firstPersonId, secondPersonId)
      desiredUnionIds.add(union.id)
      associateUnion(graph, treeId, union.id)
      const marriageEvent = ensureMarriedEvent(graph, union.id)
      const eventDate =
        person.marriageDates[spouseId]
        ?? data[spouseId]?.marriageDates[person.id]
      if (marriageEvent.eventDate !== eventDate) {
        graph.unionEvents[marriageEvent.id] = {
          ...marriageEvent,
          eventDate,
        }
      }
    }
  }
  for (const [key, association] of Object.entries(graph.treeUnions)) {
    if (
      association.treeId === treeId
      && !desiredUnionIds.has(association.unionId)
    ) {
      delete graph.treeUnions[key]
    }
  }

  const desiredParentRelationshipIds = new Set<string>()
  for (const child of Object.values(data)) {
    for (const parent of child.parents) {
      if (!data[parent.id] || parent.id === child.id) continue
      const desiredType =
        parent.type ?? (parent.adopted ? "adoptive" : "biological")
      const relationship = ensureParentChildRelationship(
        graph,
        parent.id,
        child.id,
        desiredType,
      )
      if (!relationship) {
        throw new Error(
          "Parent relationships would create a cycle or third parent",
        )
      }
      if (relationship.type !== desiredType) {
        graph.parentChildRelationships[relationship.id] = {
          ...relationship,
          type: desiredType,
        }
      }
      desiredParentRelationshipIds.add(relationship.id)
      associateParentChildRelationship(graph, treeId, relationship.id)
    }
  }
  for (const [key, association] of Object.entries(
    graph.treeParentChildRelationships,
  )) {
    if (
      association.treeId === treeId
      && !desiredParentRelationshipIds.has(
        association.parentChildRelationshipId,
      )
    ) {
      delete graph.treeParentChildRelationships[key]
    }
  }
}

export function linkSpouseRecords(
  previous: GlobalState,
  treeIds: Iterable<string>,
  firstPersonId: string,
  secondPersonId: string,
): GlobalState {
  if (
    firstPersonId === secondPersonId
    || !previous.persons[firstPersonId]
    || !previous.persons[secondPersonId]
  ) {
    return previous
  }
  const eligibleTreeIds = [...treeIds].filter(
    (treeId) =>
      treeIsWritable(previous, treeId)
      && hasMember(previous, treeId, firstPersonId)
      && hasMember(previous, treeId, secondPersonId),
  )
  if (eligibleTreeIds.length === 0) return previous
  const draft = makeDraft(previous)
  const union = ensureUnion(draft, firstPersonId, secondPersonId)
  for (const treeId of eligibleTreeIds) associateUnion(draft, treeId, union.id)
  return draft
}

export function unlinkSpouseRecords(
  previous: GlobalState,
  treeId: string,
  firstPersonId: string,
  secondPersonId: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const union = currentUnionForPair(
    previous,
    firstPersonId,
    secondPersonId,
    treeId,
  )
  if (!union) return previous
  const draft = makeDraft(previous)
  delete draft.treeUnions[treeUnionKey(treeId, union.id)]
  return draft
}

export function updateSpouseDateRecords(
  previous: GlobalState,
  treeId: string,
  firstPersonId: string,
  secondPersonId: string,
  date: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const union = currentUnionForPair(
    previous,
    firstPersonId,
    secondPersonId,
    treeId,
  )
  if (!union) return previous
  const draft = makeDraft(previous)
  const event = ensureMarriedEvent(draft, union.id)
  draft.unionEvents[event.id] = {
    ...event,
    eventDate: date || undefined,
  }
  return draft
}

export function removeParentRecords(
  previous: GlobalState,
  treeId: string,
  childPersonId: string,
  parentPersonId: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const relationship = parentRelationshipForPair(
    previous,
    parentPersonId,
    childPersonId,
    treeId,
  )
  if (!relationship) return previous
  const draft = makeDraft(previous)
  delete draft.treeParentChildRelationships[
    treeParentChildRelationshipKey(treeId, relationship.id)
  ]
  return draft
}

export function setParentAdoptedRecords(
  previous: GlobalState,
  treeId: string,
  childPersonId: string,
  parentPersonId: string,
  adopted: boolean,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const relationship = parentRelationshipForPair(
    previous,
    parentPersonId,
    childPersonId,
    treeId,
  )
  if (!relationship) return previous
  return {
    ...previous,
    parentChildRelationships: {
      ...previous.parentChildRelationships,
      [relationship.id]: {
        ...relationship,
        type: adopted ? "adoptive" : "biological",
      },
    },
  }
}

export function removeFromTreeRecords(
  previous: GlobalState,
  personId: string,
  treeId: string,
): GlobalState {
  if (
    !treeIsWritable(previous, treeId)
    || !hasMember(previous, treeId, personId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  removePersonFromTreeRecords(draft, personId, treeId)
  return draft
}

export function addMemberWithSpousesRecords(
  previous: GlobalState,
  treeId: string,
  personId: string,
): GlobalState {
  if (
    !treeIsWritable(previous, treeId)
    || !previous.persons[personId]
    || hasMember(previous, treeId, personId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  addMemberWithCurrentSpouses(draft, treeId, personId)
  return draft
}

export function deletePersonRecords(
  previous: GlobalState,
  personId: string,
): GlobalState {
  if (!previous.persons[personId]) return previous
  const draft = makeDraft(previous)
  delete draft.persons[personId]
  for (const member of Object.values(previous.treeMembers)) {
    if (member.personId === personId) {
      removePersonFromTreeRecords(draft, personId, member.treeId)
    }
  }
  return draft
}

// ---------------------------------------------------------------------------
// Hooks and UI-compatible operations.
// ---------------------------------------------------------------------------

export type TreeSeed = { people: FamilyData }

export function seedData(): TreeSeed {
  const grandpa = newId()
  const grandma = newId()
  const dad = newId()
  const mom = newId()
  const kid = newId()
  return {
    people: {
      [grandpa]: {
        id: grandpa,
        name: "Henry Tan",
        gender: "male",
        dob: "1948-03-02",
        dod: "2019-05-20",
        location: "Penang",
        parents: [],
        spouseIds: [grandma],
        marriageDates: { [grandma]: "1971-09-14" },
      },
      [grandma]: {
        id: grandma,
        name: "Mei Ling",
        gender: "female",
        dob: "1952-11-19",
        location: "Penang",
        parents: [],
        spouseIds: [grandpa],
        marriageDates: { [grandpa]: "1971-09-14" },
      },
      [dad]: {
        id: dad,
        name: "David Tan",
        gender: "male",
        dob: "1976-06-30",
        location: "Kuala Lumpur",
        parents: [{ id: grandpa }, { id: grandma }],
        spouseIds: [mom],
        marriageDates: { [mom]: "2001-06-20" },
      },
      [mom]: {
        id: mom,
        name: "Sarah Lim",
        gender: "female",
        dob: "1979-01-15",
        location: "Kuala Lumpur",
        parents: [],
        spouseIds: [dad],
        marriageDates: { [dad]: "2001-06-20" },
      },
      [kid]: {
        id: kid,
        name: "Alex Tan",
        dob: "2008-09-05",
        location: "Singapore",
        parents: [{ id: dad }, { id: mom }],
        spouseIds: [],
        marriageDates: {},
      },
    },
  }
}

export function useTreeIndex() {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)

  const createTree = useCallback((name: string, seed?: TreeSeed): string => {
    const id = newId()
    update((previous) => {
      const draft = makeDraft(previous)
      draft.index = [
        ...previous.index,
        { id, name, createdAt: new Date().toISOString() },
      ]
      if (seed) reconcileTreeData(draft, id, seed.people)
      return draft
    })
    return id
  }, [])

  const renameTree = useCallback((id: string, name: string) => {
    update((previous) => ({
      ...previous,
      index: previous.index.map((tree) =>
        tree.id === id ? { ...tree, name } : tree,
      ),
    }))
  }, [])

  const deleteTree = useCallback(deleteTreeById, [])

  return { trees: graph.index, createTree, renameTree, deleteTree }
}

export async function deleteTreeById(id: string): Promise<void> {
  const response = await fetch(`/api/trees/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!response.ok) throw new Error(`delete failed: ${response.status}`)

  update(
    (previous) => {
      const draft = makeDraft(previous)
      draft.index = previous.index.filter((tree) => tree.id !== id)
      for (const [key, member] of Object.entries(draft.treeMembers)) {
        if (member.treeId === id) delete draft.treeMembers[key]
      }
      for (const [key, association] of Object.entries(draft.treeUnions)) {
        if (association.treeId === id) delete draft.treeUnions[key]
      }
      for (const [key, association] of Object.entries(
        draft.treeParentChildRelationships,
      )) {
        if (association.treeId === id) {
          delete draft.treeParentChildRelationships[key]
        }
      }
      return draft
    },
    { remote: true },
  )
}

export type TreeIndexStore = ReturnType<typeof useTreeIndex>

export function countMembers(treeId: string): number {
  return Object.values(state.treeMembers).filter(
    (member) => member.treeId === treeId,
  ).length
}

export function useMemberTrees(personId: string): TreeMeta[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(
    () => graph.index.filter((tree) => hasMember(graph, tree.id, personId)),
    [graph, personId],
  )
}

export function useMembersOf(
  treeId: string | undefined,
): { id: string; name: string }[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    if (!treeId) return []
    return Object.values(graph.treeMembers)
      .filter((member) => member.treeId === treeId)
      .sort(
        (first, second) =>
          first.createdAt.localeCompare(second.createdAt)
          || first.personId.localeCompare(second.personId),
      )
      .map((member) => ({
        id: member.personId,
        name: graph.persons[member.personId]?.name ?? "?",
      }))
  }, [graph, treeId])
}

export function useTreePeople(treeId: string | undefined): Person[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(
    () =>
      treeId ? Object.values(projectTree(graph.persons, graph, treeId)) : [],
    [graph, treeId],
  )
}

export type PersonSearchResult = {
  personId: string
  name: string
  /** Earliest tree the person belongs to. */
  treeId: string
}

/** Every person in the store, each paired with the earliest tree they're in. */
export function usePersonSearch(): PersonSearchResult[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    const treeExists = new Set(graph.index.map((tree) => tree.id))
    const earliest = new Map<
      string,
      { personId: string; treeId: string; createdAt: string }
    >()
    for (const member of Object.values(graph.treeMembers)) {
      if (!treeExists.has(member.treeId)) continue
      if (!graph.persons[member.personId]) continue
      const current = earliest.get(member.personId)
      if (!current || member.createdAt.localeCompare(current.createdAt) < 0) {
        earliest.set(member.personId, {
          personId: member.personId,
          treeId: member.treeId,
          createdAt: member.createdAt,
        })
      }
    }
    return [...earliest.values()].map((result) => ({
      personId: result.personId,
      name: graph.persons[result.personId]?.name ?? "",
      treeId: result.treeId,
    }))
  }, [graph])
}

export function useFamilyAll(treeId: string, enabled: boolean): FamilyData {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    if (!enabled) return projectTree(graph.persons, graph, treeId)
    const treeIds = [
      treeId,
      ...graph.index
        .filter((tree) => tree.id !== treeId)
        .map((tree) => tree.id),
    ]
    return projectTrees(graph.persons, graph, treeIds)
  }, [graph, treeId, enabled])
}

export function useFamily(treeId: string) {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  const people = useMemo(
    () => projectTree(graph.persons, graph, treeId),
    [graph, treeId],
  )
  const readOnly = useMemo(
    () => graph.index.find((tree) => tree.id === treeId)?.role === "viewer",
    [graph, treeId],
  )

  const addPerson = useCallback(
    (input: PersonInput, relationship: Relationship): string => {
      const id = newId()
      update((previous) => {
        if (!treeIsWritable(previous, treeId)) return previous
        const draft = makeDraft(previous)
        draft.persons[id] = { id, ...input }
        addMember(draft, treeId, id)

        if (relationship.kind === "spouse") {
          const union = ensureUnion(draft, id, relationship.partnerId)
          associateUnion(draft, treeId, union.id)
          for (const targetTreeId of treesWithMember(
            previous,
            relationship.partnerId,
            treeId,
          )) {
            addMember(draft, targetTreeId, id)
            associateUnion(draft, targetTreeId, union.id)
          }
        } else if (relationship.kind === "child") {
          const parentIds = [
            relationship.parentId,
            relationship.otherParentId,
          ].filter((candidate): candidate is string => !!candidate)
          const relationships: ParentChildRelationship[] = []
          for (const parentId of parentIds) {
            const parentRelationship = ensureParentChildRelationship(
              draft,
              parentId,
              id,
              relationship.adopted ? "adoptive" : "biological",
            )
            if (!parentRelationship) return previous
            relationships.push(parentRelationship)
          }
          for (const parentRelationship of relationships) {
            associateParentChildRelationship(
              draft,
              treeId,
              parentRelationship.id,
            )
          }
          for (const targetTreeId of treesContainingAll(
            previous,
            parentIds,
            treeId,
          )) {
            addMember(draft, targetTreeId, id)
            for (const parentRelationship of relationships) {
              associateParentChildRelationship(
                draft,
                targetTreeId,
                parentRelationship.id,
              )
            }
          }
        } else if (relationship.kind === "parent") {
          const parentRelationship = ensureParentChildRelationship(
            draft,
            id,
            relationship.childId,
          )
          if (!parentRelationship) return previous
          associateParentChildRelationship(draft, treeId, parentRelationship.id)
          if (relationship.marryExisting) {
            const child = projectTree(draft.persons, draft, treeId)[
              relationship.childId
            ]
            const existingParentId = child?.parents.find(
              (parent) => parent.id !== id,
            )?.id
            if (existingParentId) {
              const union = ensureUnion(draft, id, existingParentId)
              associateUnion(draft, treeId, union.id)
              for (const targetTreeId of treesWithMember(
                previous,
                existingParentId,
                treeId,
              )) {
                addMember(draft, targetTreeId, id)
                associateUnion(draft, targetTreeId, union.id)
              }
            }
          }
        }
        return draft
      })
      return id
    },
    [treeId],
  )

  const updatePerson = useCallback((id: string, input: PersonInput) => {
    update((previous) => {
      const person = previous.persons[id]
      if (!person) return previous
      return {
        ...previous,
        persons: { ...previous.persons, [id]: { ...person, ...input } },
      }
    })
  }, [])

  const deletePerson = useCallback((id: string) => {
    update((previous) => deletePersonRecords(previous, id))
  }, [])

  const mergePersons = useCallback((keepId: string, dropId: string) => {
    update((previous) => mergePersonRecords(previous, keepId, dropId))
  }, [])

  const linkSpouse = useCallback(
    (firstPersonId: string, secondPersonId: string) => {
      update((previous) => {
        const targetTreeIds = [
          treeId,
          ...treesContainingAll(
            previous,
            [firstPersonId, secondPersonId],
            treeId,
          ),
        ]
        return linkSpouseRecords(
          previous,
          targetTreeIds,
          firstPersonId,
          secondPersonId,
        )
      })
    },
    [treeId],
  )

  const unlinkSpouse = useCallback(
    (firstPersonId: string, secondPersonId: string) => {
      update((previous) =>
        unlinkSpouseRecords(previous, treeId, firstPersonId, secondPersonId),
      )
    },
    [treeId],
  )

  const updateSpouseDate = useCallback(
    (firstPersonId: string, secondPersonId: string, date: string) => {
      update((previous) =>
        updateSpouseDateRecords(
          previous,
          treeId,
          firstPersonId,
          secondPersonId,
          date,
        ),
      )
    },
    [treeId],
  )

  const addParent = useCallback(
    (childPersonId: string, parentPersonId: string) => {
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !previous.persons[childPersonId]
          || !previous.persons[parentPersonId]
          || childPersonId === parentPersonId
        ) {
          return previous
        }
        const family = projectTree(previous.persons, previous, treeId)
        if (descendantsOf(family, childPersonId).has(parentPersonId)) {
          return previous
        }
        const draft = makeDraft(previous)
        const relationship = ensureParentChildRelationship(
          draft,
          parentPersonId,
          childPersonId,
        )
        if (!relationship) return previous
        associateParentChildRelationship(draft, treeId, relationship.id)

        const projected = projectTree(draft.persons, draft, treeId)
        const parentIds =
          projected[childPersonId]?.parents.map((parent) => parent.id) ?? []
        for (const targetTreeId of treesContainingAll(
          previous,
          parentIds,
          treeId,
        )) {
          addMember(draft, targetTreeId, childPersonId)
          for (const candidateParentId of parentIds) {
            const candidateRelationship = ensureParentChildRelationship(
              draft,
              candidateParentId,
              childPersonId,
            )
            if (!candidateRelationship) continue
            associateParentChildRelationship(
              draft,
              targetTreeId,
              candidateRelationship.id,
            )
          }
        }
        return draft
      })
    },
    [treeId],
  )

  const removeParent = useCallback(
    (childPersonId: string, parentPersonId: string) => {
      update((previous) =>
        removeParentRecords(previous, treeId, childPersonId, parentPersonId),
      )
    },
    [treeId],
  )

  const setParentAdopted = useCallback(
    (childPersonId: string, parentPersonId: string, adopted: boolean) => {
      update((previous) =>
        setParentAdoptedRecords(
          previous,
          treeId,
          childPersonId,
          parentPersonId,
          adopted,
        ),
      )
    },
    [treeId],
  )

  const linkAcrossTrees = useCallback(
    (personId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !treeIsWritable(previous, otherTreeId)
          || !previous.persons[personId]
          || !previous.persons[otherPersonId]
        ) {
          return previous
        }
        const draft = makeDraft(previous)
        const union = ensureUnion(draft, personId, otherPersonId)
        addMember(draft, treeId, otherPersonId)
        addMember(draft, otherTreeId, personId)
        associateUnion(draft, treeId, union.id)
        associateUnion(draft, otherTreeId, union.id)
        for (const targetTreeId of treesContainingAll(previous, [
          personId,
          otherPersonId,
        ])) {
          associateUnion(draft, targetTreeId, union.id)
        }
        return draft
      })
    },
    [treeId],
  )

  const linkParentAcrossTrees = useCallback(
    (childPersonId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !treeIsWritable(previous, otherTreeId)
          || !previous.persons[childPersonId]
          || !previous.persons[otherPersonId]
        ) {
          return previous
        }
        const otherFamily = projectTree(previous.persons, previous, otherTreeId)
        if (descendantsOf(otherFamily, childPersonId).has(otherPersonId)) {
          return previous
        }

        const currentFamily = projectTree(previous.persons, previous, treeId)
        const included = new Set<string>([childPersonId])
        for (const descendant of descendantsOf(currentFamily, childPersonId)) {
          included.add(descendant)
        }
        for (const personId of [...included]) {
          for (const spouseId of currentFamily[personId]?.spouseIds ?? []) {
            if (currentFamily[spouseId]) included.add(spouseId)
          }
        }

        const draft = makeDraft(previous)
        for (const personId of included) {
          addMemberWithCurrentSpouses(draft, otherTreeId, personId)
        }
        for (const personId of included) {
          const person = currentFamily[personId]
          if (!person) continue
          for (const parent of person.parents) {
            if (!included.has(parent.id)) continue
            const relationship = ensureParentChildRelationship(
              draft,
              parent.id,
              personId,
              parent.type ?? (parent.adopted ? "adoptive" : "biological"),
            )
            if (!relationship) return previous
            associateParentChildRelationship(
              draft,
              otherTreeId,
              relationship.id,
            )
          }
          for (const spouseId of person.spouseIds) {
            if (!included.has(spouseId)) continue
            const union = ensureUnion(draft, personId, spouseId)
            associateUnion(draft, otherTreeId, union.id)
          }
        }

        const selectedParentRelationship = ensureParentChildRelationship(
          draft,
          otherPersonId,
          childPersonId,
        )
        if (!selectedParentRelationship) return previous
        associateParentChildRelationship(
          draft,
          otherTreeId,
          selectedParentRelationship.id,
        )
        for (const spouseId of otherFamily[otherPersonId]?.spouseIds ?? []) {
          const spouseRelationship = ensureParentChildRelationship(
            draft,
            spouseId,
            childPersonId,
          )
          if (!spouseRelationship) return previous
          associateParentChildRelationship(
            draft,
            otherTreeId,
            spouseRelationship.id,
          )
        }
        return draft
      })
    },
    [treeId],
  )

  const linkChildAcrossTrees = useCallback(
    (parentPersonId: string, otherTreeId: string, childPersonId: string) => {
      linkParentAcrossTrees(childPersonId, otherTreeId, parentPersonId)
    },
    [linkParentAcrossTrees],
  )

  const removeFromTree = useCallback(
    (personId: string, targetTreeId: string) => {
      update((previous) =>
        removeFromTreeRecords(previous, personId, targetTreeId),
      )
    },
    [],
  )

  const replaceAll = useCallback(
    (data: FamilyData) => {
      update((previous) => {
        if (!treeIsWritable(previous, treeId)) return previous
        const draft = makeDraft(previous)
        reconcileTreeData(draft, treeId, data)
        return draft
      })
    },
    [treeId],
  )

  return {
    people,
    readOnly,
    addPerson,
    updatePerson,
    deletePerson,
    mergePersons,
    linkSpouse,
    unlinkSpouse,
    updateSpouseDate,
    addParent,
    removeParent,
    setParentAdopted,
    linkAcrossTrees,
    linkParentAcrossTrees,
    linkChildAcrossTrees,
    removeFromTree,
    replaceAll,
  }
}

function compareCreatedRecords(
  first: { id: string; createdAt: string },
  second: { id: string; createdAt: string },
): number {
  return (
    first.createdAt.localeCompare(second.createdAt)
    || first.id.localeCompare(second.id)
  )
}

function createReplacementUnion(
  graph: GlobalState,
  source: Union,
  firstPersonId: string,
  secondPersonId: string,
): Union {
  const existing = currentUnionForPair(graph, firstPersonId, secondPersonId)
  if (existing) return existing
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const timestamp = now()
  const replacement: Union = {
    id: newId(),
    firstPersonId: first,
    secondPersonId: second,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unions[replacement.id] = replacement
  const marriageEvent = unionEventsFor(graph, source.id)
    .filter((event) => event.type === "married")
    .sort(compareCreatedRecords)
    .at(-1)
  if (!marriageEvent) {
    ensureMarriedEvent(graph, replacement.id)
  } else {
    const eventId = newId()
    graph.unionEvents[eventId] = {
      ...marriageEvent,
      id: eventId,
      unionId: replacement.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  return replacement
}

/** Merge identities by replacing writable-tree associations, never fact endpoints. */
export function mergePersonRecords(
  previous: GlobalState,
  keepId: string,
  dropId: string,
): GlobalState {
  const keep = previous.persons[keepId]
  const drop = previous.persons[dropId]
  if (
    keepId === dropId
    || !keep
    || !drop
    || !personHasWritableTree(previous, keepId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  draft.persons[keepId] = {
    id: keepId,
    name: keep.name || drop.name,
    dob: keep.dob ?? drop.dob,
    dod: keep.dod ?? drop.dod,
    gender: keep.gender ?? drop.gender,
    location: keep.location ?? drop.location,
    photo: keep.photo ?? drop.photo,
    ownerId: keep.ownerId ?? drop.ownerId,
  }
  delete draft.persons[dropId]

  for (const member of Object.values(previous.treeMembers)) {
    if (
      member.personId !== dropId
      || !treeIsWritable(previous, member.treeId)
    ) {
      continue
    }
    addMember(draft, member.treeId, keepId)
    removeMember(draft, member.treeId, dropId)
  }

  const replacementUnions = new Map<string, Union>()
  const unionAssociations = Object.entries(previous.treeUnions).sort(
    ([firstKey], [secondKey]) => firstKey.localeCompare(secondKey),
  )
  for (const [associationKey, association] of unionAssociations) {
    if (!treeIsWritable(previous, association.treeId)) continue
    const union = previous.unions[association.unionId]
    if (
      !union
      || (union.firstPersonId !== dropId && union.secondPersonId !== dropId)
    ) {
      continue
    }
    delete draft.treeUnions[associationKey]
    const firstPersonId =
      union.firstPersonId === dropId ? keepId : union.firstPersonId
    const secondPersonId =
      union.secondPersonId === dropId ? keepId : union.secondPersonId
    if (firstPersonId === secondPersonId) continue
    const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
    const pairKey = `${first}:${second}`
    let replacement = replacementUnions.get(pairKey)
    if (!replacement) {
      replacement = createReplacementUnion(draft, union, first, second)
      replacementUnions.set(pairKey, replacement)
    }
    associateUnion(draft, association.treeId, replacement.id)
  }

  const replacementParentRelationships = new Map<
    string,
    ParentChildRelationship
  >()
  const parentAssociations = Object.entries(
    previous.treeParentChildRelationships,
  ).sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
  for (const [associationKey, association] of parentAssociations) {
    if (!treeIsWritable(previous, association.treeId)) continue
    const relationship =
      previous.parentChildRelationships[association.parentChildRelationshipId]
    if (
      !relationship
      || (relationship.parentPersonId !== dropId
        && relationship.childPersonId !== dropId)
    ) {
      continue
    }
    delete draft.treeParentChildRelationships[associationKey]
    const parentPersonId =
      relationship.parentPersonId === dropId
        ? keepId
        : relationship.parentPersonId
    const childPersonId =
      relationship.childPersonId === dropId
        ? keepId
        : relationship.childPersonId
    if (parentPersonId === childPersonId) continue
    const pairKey = `${parentPersonId}:${childPersonId}`
    let replacement = replacementParentRelationships.get(pairKey)
    if (!replacement) {
      replacement = ensureParentChildRelationship(
        draft,
        parentPersonId,
        childPersonId,
        relationship.type,
      )
      if (!replacement) continue
      replacementParentRelationships.set(pairKey, replacement)
    }
    associateParentChildRelationship(draft, association.treeId, replacement.id)
  }
  return draft
}

export type FamilyStore = ReturnType<typeof useFamily>
