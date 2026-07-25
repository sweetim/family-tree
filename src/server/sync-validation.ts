import type { SyncPushRequest } from "../sync/types"

export type ParentEdge = {
  id: string
  parentPersonId: string
  childPersonId: string
}

export type ParentAssociationValidation =
  | "valid"
  | "self-parent"
  | "too-many-parents"
  | "ancestry-cycle"

export type SyncCollectionName = keyof SyncPushRequest

export const MAX_CLIENT_FUTURE_MILLISECONDS = 5 * 60 * 1000
export const MAX_SYNC_ID_LENGTH = 512
export const MAX_SYNC_TEXT_LENGTH = 10_000
export const MAX_SYNC_PHOTO_LENGTH = 1024 * 1024
export const MAX_SYNC_RECORDS_PER_COLLECTION = 2_000
export const MAX_SYNC_TOTAL_RECORDS = 5_000

const SYNC_COLLECTIONS = [
  "persons",
  "trees",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const satisfies readonly SyncCollectionName[]
const GENDERS = new Set(["male", "female", "other"])
const TREE_ROLES = new Set(["owner", "editor", "viewer"])
const UNION_EVENT_TYPES = new Set([
  "relationship_started",
  "engaged",
  "married",
  "civil_union",
  "domestic_partnership",
  "separated",
  "reconciled",
  "divorced",
  "annulled",
  "relationship_ended",
])
const PARENT_RELATIONSHIP_TYPES = new Set([
  "biological",
  "adoptive",
  "foster",
  "guardian",
  "step",
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
  )
}

function isValidText(
  value: unknown,
  maximumLength = MAX_SYNC_TEXT_LENGTH,
): value is string {
  return (
    typeof value === "string"
    && value.length <= maximumLength
    && !value.includes("\0")
  )
}

export function isValidSyncId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_SYNC_ID_LENGTH
    && /^[\x20-\x7e]+$/.test(value)
  )
}

export function activeDependencyIds<T extends { deletedAt: Date | null }>(
  rows: readonly T[],
  idFor: (row: T) => string,
): string[] {
  return rows.filter((row) => row.deletedAt === null).map(idFor)
}

export function isReasonableClientTimestamp(
  value: unknown,
  now: Date,
): value is string {
  if (!isValidTimestamp(value)) return false
  return (
    new Date(value).getTime() <= now.getTime() + MAX_CLIENT_FUTURE_MILLISECONDS
  )
}

function isValidGenericTombstone(
  value: Record<string, unknown>,
  now: Date,
): boolean {
  return (
    hasExactKeys(value, ["id", "updatedAt", "deletedAt"])
    && isValidSyncId(value.id)
    && isReasonableClientTimestamp(value.updatedAt, now)
    && isReasonableClientTimestamp(value.deletedAt, now)
  )
}

function isValidAssociationTombstone(
  value: Record<string, unknown>,
  firstId: string,
  secondId: string,
  now: Date,
): boolean {
  return (
    hasExactKeys(value, [firstId, secondId, "updatedAt", "deletedAt"])
    && isValidSyncId(value[firstId])
    && isValidSyncId(value[secondId])
    && isReasonableClientTimestamp(value.updatedAt, now)
    && isReasonableClientTimestamp(value.deletedAt, now)
  )
}

function isOptionalString(value: unknown, maximumLength?: number): boolean {
  return value === undefined || isValidText(value, maximumLength)
}

function isOptionalPhoto(value: unknown): boolean {
  return value === null || isOptionalString(value, MAX_SYNC_PHOTO_LENGTH)
}

function isValidPersonWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidGenericTombstone(value, now)
  }
  return (
    hasExactKeys(
      value,
      ["id", "name", "updatedAt"],
      ["dob", "dod", "gender", "location", "photo", "ownerId"],
    )
    && isValidSyncId(value.id)
    && isValidText(value.name)
    && (value.dob === undefined || isValidIsoDate(value.dob))
    && (value.dod === undefined || isValidIsoDate(value.dod))
    && (value.gender === undefined || GENDERS.has(value.gender as string))
    && isOptionalString(value.location)
    && isOptionalPhoto(value.photo)
    && (value.ownerId === undefined || isValidSyncId(value.ownerId))
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidTreeWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidGenericTombstone(value, now)
  }
  return (
    hasExactKeys(
      value,
      ["id", "name", "createdAt", "updatedAt"],
      ["ownerId", "ownerEmail", "role"],
    )
    && isValidSyncId(value.id)
    && isValidText(value.name)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
    && (value.ownerId === undefined
      || value.ownerId === ""
      || isValidSyncId(value.ownerId))
    && (value.ownerEmail === undefined
      || value.ownerEmail === null
      || typeof value.ownerEmail === "string")
    && (value.role === undefined || TREE_ROLES.has(value.role as string))
  )
}

function isValidTreeMemberWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidAssociationTombstone(value, "treeId", "personId", now)
  }
  return (
    hasExactKeys(value, ["treeId", "personId", "createdAt", "updatedAt"])
    && isValidSyncId(value.treeId)
    && isValidSyncId(value.personId)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidUnionWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidGenericTombstone(value, now)
  }
  return (
    hasExactKeys(value, [
      "id",
      "firstPersonId",
      "secondPersonId",
      "createdAt",
      "updatedAt",
    ])
    && isValidSyncId(value.id)
    && isValidSyncId(value.firstPersonId)
    && isValidSyncId(value.secondPersonId)
    && isCanonicalUnion(value.firstPersonId, value.secondPersonId)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidUnionEventWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidGenericTombstone(value, now)
  }
  return (
    hasExactKeys(
      value,
      ["id", "unionId", "type", "createdAt", "updatedAt"],
      ["eventDate"],
    )
    && isValidSyncId(value.id)
    && isValidSyncId(value.unionId)
    && UNION_EVENT_TYPES.has(value.type as string)
    && (value.eventDate === undefined || isValidIsoDate(value.eventDate))
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidTreeUnionWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidAssociationTombstone(value, "treeId", "unionId", now)
  }
  return (
    hasExactKeys(value, ["treeId", "unionId", "createdAt", "updatedAt"])
    && isValidSyncId(value.treeId)
    && isValidSyncId(value.unionId)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidParentRelationshipWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidGenericTombstone(value, now)
  }
  return (
    hasExactKeys(value, [
      "id",
      "parentPersonId",
      "childPersonId",
      "type",
      "createdAt",
      "updatedAt",
    ])
    && isValidSyncId(value.id)
    && isValidSyncId(value.parentPersonId)
    && isValidSyncId(value.childPersonId)
    && value.parentPersonId !== value.childPersonId
    && PARENT_RELATIONSHIP_TYPES.has(value.type as string)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function isValidTreeParentRelationshipWire(value: unknown, now: Date): boolean {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, "deletedAt")) {
    return isValidAssociationTombstone(
      value,
      "treeId",
      "parentChildRelationshipId",
      now,
    )
  }
  return (
    hasExactKeys(value, [
      "treeId",
      "parentChildRelationshipId",
      "createdAt",
      "updatedAt",
    ])
    && isValidSyncId(value.treeId)
    && isValidSyncId(value.parentChildRelationshipId)
    && isReasonableClientTimestamp(value.createdAt, now)
    && isReasonableClientTimestamp(value.updatedAt, now)
  )
}

function hasUniqueKeys(
  records: unknown[],
  keyFor: (record: Record<string, unknown>) => string,
): boolean {
  const keys = new Set<string>()
  for (const record of records) {
    if (!isObject(record)) return false
    const key = keyFor(record)
    if (keys.has(key)) return false
    keys.add(key)
  }
  return true
}

export function isValidSyncPushRequest(
  value: unknown,
  now: Date,
): value is SyncPushRequest {
  if (
    !isObject(value)
    || !hasExactKeys(value, [...SYNC_COLLECTIONS])
    || !SYNC_COLLECTIONS.every((collection) => Array.isArray(value[collection]))
  ) {
    return false
  }

  const persons = value.persons as unknown[]
  const trees = value.trees as unknown[]
  const treeMembers = value.treeMembers as unknown[]
  const unions = value.unions as unknown[]
  const unionEvents = value.unionEvents as unknown[]
  const treeUnions = value.treeUnions as unknown[]
  const parentRelationships = value.parentChildRelationships as unknown[]
  const treeParentRelationships =
    value.treeParentChildRelationships as unknown[]

  const collections = SYNC_COLLECTIONS.map(
    (collection) => value[collection] as unknown[],
  )
  if (
    collections.some(
      (collection) => collection.length > MAX_SYNC_RECORDS_PER_COLLECTION,
    )
    || collections.reduce((total, collection) => total + collection.length, 0)
      > MAX_SYNC_TOTAL_RECORDS
  ) {
    return false
  }

  return (
    persons.every((record) => isValidPersonWire(record, now))
    && trees.every((record) => isValidTreeWire(record, now))
    && treeMembers.every((record) => isValidTreeMemberWire(record, now))
    && unions.every((record) => isValidUnionWire(record, now))
    && unionEvents.every((record) => isValidUnionEventWire(record, now))
    && treeUnions.every((record) => isValidTreeUnionWire(record, now))
    && parentRelationships.every((record) =>
      isValidParentRelationshipWire(record, now),
    )
    && treeParentRelationships.every((record) =>
      isValidTreeParentRelationshipWire(record, now),
    )
    && hasUniqueKeys(persons, (record) => String(record.id))
    && hasUniqueKeys(trees, (record) => String(record.id))
    && hasUniqueKeys(treeMembers, (record) =>
      associationKey(String(record.treeId), String(record.personId)),
    )
    && hasUniqueKeys(unions, (record) => String(record.id))
    && hasUniqueKeys(unionEvents, (record) => String(record.id))
    && hasUniqueKeys(treeUnions, (record) =>
      associationKey(String(record.treeId), String(record.unionId)),
    )
    && hasUniqueKeys(parentRelationships, (record) => String(record.id))
    && hasUniqueKeys(treeParentRelationships, (record) =>
      associationKey(
        String(record.treeId),
        String(record.parentChildRelationshipId),
      ),
    )
  )
}

export function clientCanTombstone(collection: SyncCollectionName): boolean {
  return (
    collection !== "unions"
    && collection !== "unionEvents"
    && collection !== "parentChildRelationships"
  )
}

export function associationKey(firstId: string, secondId: string): string {
  return JSON.stringify([firstId, secondId])
}

export function isCanonicalUnion(
  firstPersonId: string,
  secondPersonId: string,
): boolean {
  return firstPersonId < secondPersonId
}

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [year, month, day] = value.split("-").map(Number)
  if (
    year === undefined
    || month === undefined
    || day === undefined
    || year < 1
  ) {
    return false
  }
  const parsed = new Date(0)
  parsed.setUTCHours(0, 0, 0, 0)
  parsed.setUTCFullYear(year, month - 1, day)
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
  )
}

export function validateParentAssociation(
  existingEdges: ParentEdge[],
  candidate: ParentEdge,
): ParentAssociationValidation {
  if (candidate.parentPersonId === candidate.childPersonId) {
    return "self-parent"
  }

  const edges = existingEdges.filter((edge) => edge.id !== candidate.id)
  const parentIds = new Set(
    edges
      .filter((edge) => edge.childPersonId === candidate.childPersonId)
      .map((edge) => edge.parentPersonId),
  )
  parentIds.add(candidate.parentPersonId)
  if (parentIds.size > 2) return "too-many-parents"

  const childrenByParent = new Map<string, string[]>()
  for (const edge of [...edges, candidate]) {
    const children = childrenByParent.get(edge.parentPersonId) ?? []
    children.push(edge.childPersonId)
    childrenByParent.set(edge.parentPersonId, children)
  }

  const visited = new Set<string>()
  const pending = [candidate.childPersonId]
  while (pending.length > 0) {
    const personId = pending.pop()
    if (!personId || visited.has(personId)) continue
    if (personId === candidate.parentPersonId) return "ancestry-cycle"
    visited.add(personId)
    pending.push(...(childrenByParent.get(personId) ?? []))
  }

  return "valid"
}
