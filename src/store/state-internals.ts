/**
 * Stateless internals extracted from `state.ts`: constants, key/identity
 * helpers, and pure functions that depend only on their arguments (never on the
 * module-scoped mutable store state). Everything that *does* read or write the
 * store's mutable singletons stays in `state.ts` for now.
 *
 * `state.ts` imports these back for its own use and re-exports the public ones,
 * so the barrel (`store/index.ts`) and sibling modules are unchanged.
 */
import type {
  ParentChildRelationshipWire,
  PersonPushWire,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncRecordSet,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreePushWire,
  TreeSnapshotResponse,
  TreeUnionWire,
  UnionEventWire,
  UnionWire,
} from "../sync/types"
import type { PersistedPendingMutation } from "./persistence"
import type {
  BlockedChange,
  DirtyAction,
  DirtyCollection,
  DirtyMap,
  DirtyState,
  GlobalState,
} from "./state"

export const RECORD_COLLECTIONS = [
  "persons",
  "trees",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const
export const SNAPSHOT_RECORD_COLLECTIONS = [
  "persons",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const satisfies readonly (keyof TreeSnapshotResponse["records"])[]

export const EPOCH = "1970-01-01T00:00:00.000Z"
export const STORED_PHOTO_MARKER = "stored-photo"
export const MAX_SYNC_BATCH_RECORDS = 5_000
export const MAX_SYNC_RECORDS_PER_COLLECTION = 2_000
export const MAX_SYNC_BATCH_BYTES = 4 * 1024 * 1024

export function isStoredPhotoMarker(value: string | undefined): boolean {
  return value === STORED_PHOTO_MARKER
}

export function newId(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
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

export function parseAssociationKey(key: string): [string, string] {
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

export function emptyDirtyState(): DirtyState {
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
// Read-only lookups over a snapshot + dirty state (pure).
// ---------------------------------------------------------------------------

export function valueFor(
  currentState: GlobalState,
  collection: DirtyCollection,
  id: string,
): unknown {
  return collection === "trees"
    ? currentState.index.find((tree) => tree.id === id)
    : currentState[collection][id]
}

export function wireId(
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

export function recordSetValue(
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
export function pullRecordSet(pull: SyncPullResponse): SyncRecordSet {
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

export type RemoteWire = {
  updatedAt: string
  deletedAt?: string
  revision?: number
}

export function remoteIsNewer(
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

// ---------------------------------------------------------------------------
// Dirty-state derived views (pure over their arguments).
// ---------------------------------------------------------------------------

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

export function hasAcknowledgedIds(
  ids: Partial<SyncPushResponse["skipped"]>,
): boolean {
  return RECORD_COLLECTIONS.some(
    (collection) => (ids[collection]?.length ?? 0) > 0,
  )
}

export function dirtyBatchKey(dirty: DirtyState): string {
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

export function persistableDirty(
  dirty: DirtyState,
): PersistedPendingMutation["dirty"] {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      [...dirty[collection]],
    ]),
  ) as PersistedPendingMutation["dirty"]
}

export function restoredDirty(
  dirty: PersistedPendingMutation["dirty"],
): DirtyState {
  return Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map(dirty[collection] ?? []),
    ]),
  ) as DirtyState
}

export function firstPendingOperation(source: DirtyState): string | undefined {
  return RECORD_COLLECTIONS.flatMap((collection) => [
    ...source[collection].values(),
  ]).find((record) => !record.blocked)?.operationId
}

export function operationExceedsRecordLimits(
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

// ---------------------------------------------------------------------------
// Push-wire serialization (pure over the snapshot + dirty batch).
// ---------------------------------------------------------------------------

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
