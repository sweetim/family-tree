import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { getDB } from "../../db/index"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
  unionEvents,
  unions,
  user,
} from "../../db/schema"
import type {
  ParentChildRelationshipWire,
  PersonWire,
  SharedTreeWire,
  SyncAppliedIds,
  SyncPullResponse,
  SyncPushResponse,
  SyncRecordSet,
  TombstoneWire,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreeRecordWire,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "../../sync/types"
import type {
  Gender,
  ParentChildRelationshipType,
  UnionEventType,
} from "../../types"
import { canWrite, personRole, type Role, treeRole } from "../acl"
import { getAuth } from "../auth"
import {
  activeDependencyIds,
  associationKey,
  clientCanTombstone,
  isCanonicalUnion,
  isReasonableClientTimestamp,
  isValidIsoDate,
  isValidSyncId,
  isValidSyncPushRequest,
  type ParentEdge,
  validateParentAssociation,
} from "../sync-validation"

export type SessionUser = {
  id: string
  email: string
}

type TreeRecords = Omit<SyncRecordSet, "trees">
type SyncCollection = keyof SyncAppliedIds

const GENDERS = new Set<Gender>(["male", "female", "other"])
const UNION_EVENT_TYPES = new Set<UnionEventType>([
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
const PARENT_RELATIONSHIP_TYPES = new Set<ParentChildRelationshipType>([
  "biological",
  "adoptive",
  "foster",
  "guardian",
  "step",
])
/** Resolve the authenticated user from a request, or null. */
export async function requireSession(
  request: Request,
): Promise<SessionUser | null> {
  const auth = getAuth()
  const result = await auth.api.getSession({ headers: request.headers })
  if (!result) return null
  return { id: result.user.id, email: result.user.email }
}

function iso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString()
}

function tombstone(
  id: string,
  updatedAt: Date | string,
  deletedAt: Date | string,
): TombstoneWire {
  return { id, updatedAt: iso(updatedAt), deletedAt: iso(deletedAt) }
}

function personToWire(row: typeof persons.$inferSelect): PersonWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    name: row.name,
    dob: row.dob ?? undefined,
    dod: row.dod ?? undefined,
    gender: (row.gender as Gender | null) ?? undefined,
    location: row.location ?? undefined,
    photo: row.photo ?? undefined,
    updatedAt: iso(row.updatedAt),
    ownerId: row.ownerId,
  }
}

function treeToWire(
  row: typeof trees.$inferSelect,
  role: Role,
  ownerEmail?: string | null,
): TreeWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    name: row.name,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ownerId: row.ownerId,
    ownerEmail,
    role,
  }
}

function treeMemberToWire(
  row: typeof treeMembers.$inferSelect,
): TreeMemberWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      personId: row.personId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    personId: row.personId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function unionToWire(row: typeof unions.$inferSelect): UnionWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    firstPersonId: row.firstPersonId,
    secondPersonId: row.secondPersonId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function unionEventToWire(
  row: typeof unionEvents.$inferSelect,
): UnionEventWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    unionId: row.unionId,
    type: row.type,
    eventDate: row.eventDate ?? undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function treeUnionToWire(row: typeof treeUnions.$inferSelect): TreeUnionWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      unionId: row.unionId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    unionId: row.unionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function parentRelationshipToWire(
  row: typeof parentChildRelationships.$inferSelect,
): ParentChildRelationshipWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    parentPersonId: row.parentPersonId,
    childPersonId: row.childPersonId,
    type: row.type,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function treeParentRelationshipToWire(
  row: typeof treeParentChildRelationships.$inferSelect,
): TreeParentChildRelationshipWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      parentChildRelationshipId: row.parentChildRelationshipId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    parentChildRelationshipId: row.parentChildRelationshipId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function uniqueBy<T>(records: T[], keyFor: (record: T) => string): T[] {
  const unique = new Map<string, T>()
  for (const record of records) unique.set(keyFor(record), record)
  return [...unique.values()]
}

function mergeTreeRecords(records: TreeRecords[]): TreeRecords {
  return {
    persons: uniqueBy(
      records.flatMap((record) => record.persons),
      (record) => record.id,
    ),
    treeMembers: uniqueBy(
      records.flatMap((record) => record.treeMembers),
      (record) => associationKey(record.treeId, record.personId),
    ),
    unions: uniqueBy(
      records.flatMap((record) => record.unions),
      (record) => record.id,
    ),
    unionEvents: uniqueBy(
      records.flatMap((record) => record.unionEvents),
      (record) => record.id,
    ),
    treeUnions: uniqueBy(
      records.flatMap((record) => record.treeUnions),
      (record) => associationKey(record.treeId, record.unionId),
    ),
    parentChildRelationships: uniqueBy(
      records.flatMap((record) => record.parentChildRelationships),
      (record) => record.id,
    ),
    treeParentChildRelationships: uniqueBy(
      records.flatMap((record) => record.treeParentChildRelationships),
      (record) =>
        associationKey(record.treeId, record.parentChildRelationshipId),
    ),
  }
}

/** Active owned rows are repeated as dependencies; tombstones remain deltas. */
async function recordsForOwnedTree(
  db: DB,
  treeId: string,
  since: Date,
  cutoff: Date,
): Promise<TreeRecords> {
  const memberRows = await db
    .select()
    .from(treeMembers)
    .where(
      and(
        eq(treeMembers.treeId, treeId),
        lte(treeMembers.updatedAt, cutoff),
        or(isNull(treeMembers.deletedAt), gt(treeMembers.updatedAt, since)),
      ),
    )
  const activeMemberIds = activeDependencyIds(memberRows, (row) => row.personId)
  const personRows =
    activeMemberIds.length === 0
      ? []
      : await db
          .select()
          .from(persons)
          .where(
            and(
              inArray(persons.id, activeMemberIds),
              lte(persons.updatedAt, cutoff),
            ),
          )

  const treeUnionRows = await db
    .select()
    .from(treeUnions)
    .where(
      and(
        eq(treeUnions.treeId, treeId),
        lte(treeUnions.updatedAt, cutoff),
        or(isNull(treeUnions.deletedAt), gt(treeUnions.updatedAt, since)),
      ),
    )
  const activeUnionIds = activeDependencyIds(
    treeUnionRows,
    (row) => row.unionId,
  )
  const unionRows =
    activeUnionIds.length === 0
      ? []
      : await db
          .select()
          .from(unions)
          .where(
            and(
              inArray(unions.id, activeUnionIds),
              lte(unions.updatedAt, cutoff),
            ),
          )
  const unionEventRows =
    activeUnionIds.length === 0
      ? []
      : await db
          .select()
          .from(unionEvents)
          .where(
            and(
              inArray(unionEvents.unionId, activeUnionIds),
              lte(unionEvents.updatedAt, cutoff),
              or(
                isNull(unionEvents.deletedAt),
                gt(unionEvents.updatedAt, since),
              ),
            ),
          )

  const treeParentRows = await db
    .select()
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(treeParentChildRelationships.treeId, treeId),
        lte(treeParentChildRelationships.updatedAt, cutoff),
        or(
          isNull(treeParentChildRelationships.deletedAt),
          gt(treeParentChildRelationships.updatedAt, since),
        ),
      ),
    )
  const activeParentRelationshipIds = activeDependencyIds(
    treeParentRows,
    (row) => row.parentChildRelationshipId,
  )
  const parentRows =
    activeParentRelationshipIds.length === 0
      ? []
      : await db
          .select()
          .from(parentChildRelationships)
          .where(
            and(
              inArray(parentChildRelationships.id, activeParentRelationshipIds),
              lte(parentChildRelationships.updatedAt, cutoff),
            ),
          )

  return {
    persons: personRows.map(personToWire),
    treeMembers: memberRows.map(treeMemberToWire),
    unions: unionRows.map(unionToWire),
    unionEvents: unionEventRows.map(unionEventToWire),
    treeUnions: treeUnionRows.map(treeUnionToWire),
    parentChildRelationships: parentRows.map(parentRelationshipToWire),
    treeParentChildRelationships: treeParentRows.map(
      treeParentRelationshipToWire,
    ),
  }
}

/** Shared trees are authoritative active snapshots with no former dependencies. */
async function activeRecordsForSharedTree(
  db: DB,
  treeId: string,
): Promise<TreeRecords> {
  const memberRows = await db
    .select()
    .from(treeMembers)
    .where(and(eq(treeMembers.treeId, treeId), isNull(treeMembers.deletedAt)))
  const memberIds = memberRows.map((row) => row.personId)
  const personRows =
    memberIds.length === 0
      ? []
      : await db
          .select()
          .from(persons)
          .where(and(inArray(persons.id, memberIds), isNull(persons.deletedAt)))
  const activePersonIds = new Set(personRows.map((row) => row.id))

  const treeUnionRows = await db
    .select()
    .from(treeUnions)
    .where(and(eq(treeUnions.treeId, treeId), isNull(treeUnions.deletedAt)))
  const unionIds = treeUnionRows.map((row) => row.unionId)
  const allUnionRows =
    unionIds.length === 0
      ? []
      : await db
          .select()
          .from(unions)
          .where(and(inArray(unions.id, unionIds), isNull(unions.deletedAt)))
  const unionRows = allUnionRows.filter(
    (row) =>
      activePersonIds.has(row.firstPersonId)
      && activePersonIds.has(row.secondPersonId),
  )
  const activeUnionIds = unionRows.map((row) => row.id)
  const unionEventRows =
    activeUnionIds.length === 0
      ? []
      : await db
          .select()
          .from(unionEvents)
          .where(
            and(
              inArray(unionEvents.unionId, activeUnionIds),
              isNull(unionEvents.deletedAt),
            ),
          )

  const treeParentRows = await db
    .select()
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(treeParentChildRelationships.treeId, treeId),
        isNull(treeParentChildRelationships.deletedAt),
      ),
    )
  const parentRelationshipIds = treeParentRows.map(
    (row) => row.parentChildRelationshipId,
  )
  const allParentRows =
    parentRelationshipIds.length === 0
      ? []
      : await db
          .select()
          .from(parentChildRelationships)
          .where(
            and(
              inArray(parentChildRelationships.id, parentRelationshipIds),
              isNull(parentChildRelationships.deletedAt),
            ),
          )
  const parentRows = allParentRows.filter(
    (row) =>
      activePersonIds.has(row.parentPersonId)
      && activePersonIds.has(row.childPersonId),
  )

  const activeParentIds = new Set(parentRows.map((row) => row.id))
  return {
    persons: personRows.map(personToWire),
    treeMembers: memberRows
      .filter((row) => activePersonIds.has(row.personId))
      .map(treeMemberToWire),
    unions: unionRows.map(unionToWire),
    unionEvents: unionEventRows.map(unionEventToWire),
    treeUnions: treeUnionRows
      .filter((row) => activeUnionIds.includes(row.unionId))
      .map(treeUnionToWire),
    parentChildRelationships: parentRows.map(parentRelationshipToWire),
    treeParentChildRelationships: treeParentRows
      .filter((row) => activeParentIds.has(row.parentChildRelationshipId))
      .map(treeParentRelationshipToWire),
  }
}

/** GET /api/sync?since=<iso> — normalized pull of own + shared records. */
export async function getSync(request: Request): Promise<Response> {
  const sinceParam = new URL(request.url).searchParams.get("since")
  const requestTime = new Date()
  if (sinceParam && !isReasonableClientTimestamp(sinceParam, requestTime)) {
    return Response.json({ error: "invalid since timestamp" }, { status: 400 })
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const since = sinceParam ? new Date(sinceParam) : new Date(0)
  const cutoff = new Date()
  const db = getDB()

  const ownedTreeRows = await db
    .select()
    .from(trees)
    .where(eq(trees.ownerId, me.id))
  const ownedPersonRows = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.ownerId, me.id),
        gt(persons.updatedAt, since),
        lte(persons.updatedAt, cutoff),
      ),
    )

  const ownedTreeRecords: TreeRecords[] = []
  for (const tree of ownedTreeRows) {
    if (!tree.deletedAt && tree.updatedAt <= cutoff) {
      ownedTreeRecords.push(
        await recordsForOwnedTree(db, tree.id, since, cutoff),
      )
    }
  }
  const ownDependencies = mergeTreeRecords(ownedTreeRecords)
  const own: SyncRecordSet = {
    ...ownDependencies,
    persons: uniqueBy(
      [...ownedPersonRows.map(personToWire), ...ownDependencies.persons],
      (record) => record.id,
    ),
    trees: ownedTreeRows
      .filter((row) => row.updatedAt > since && row.updatedAt <= cutoff)
      .map((row) => treeToWire(row, "owner")),
  }

  const shareRows = await db
    .select({ treeId: treeShares.treeId })
    .from(treeShares)
    .where(eq(treeShares.userId, me.id))
  const shared: SharedTreeWire[] = []
  for (const treeId of new Set(shareRows.map((share) => share.treeId))) {
    const tree = await db.query.trees.findFirst({
      where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
    })
    if (!tree || tree.ownerId === me.id) continue
    const role = await treeRole(db, me.id, tree.id)
    if (role !== "viewer" && role !== "editor") continue
    const owner = await db.query.user.findFirst({
      where: eq(user.id, tree.ownerId),
    })
    const ownerEmail = owner?.email ?? null
    const records = await activeRecordsForSharedTree(db, tree.id)
    shared.push({
      ...records,
      tree: treeToWire(tree, role, ownerEmail) as TreeRecordWire,
      role,
      ownerEmail,
    })
  }

  const body: SyncPullResponse = {
    own,
    shared,
    serverTime: cutoff.toISOString(),
  }
  return Response.json(body)
}

function emptyAppliedIds(): SyncAppliedIds {
  return {
    persons: [],
    trees: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
}

function classify(
  applied: SyncAppliedIds,
  skipped: SyncAppliedIds,
  collection: SyncCollection,
  id: string,
  wasApplied: boolean,
): void {
  ;(wasApplied ? applied : skipped)[collection].push(id)
}

function wireTimestamp(wire: { updatedAt: string }): Date | null {
  const value = new Date(wire.updatedAt)
  return Number.isFinite(value.getTime()) ? value : null
}

function wireCreatedAt(wire: { createdAt: string }): Date | null {
  const value = new Date(wire.createdAt)
  return Number.isFinite(value.getTime()) ? value : null
}

function validId(value: string): boolean {
  return isValidSyncId(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

async function activePeopleExist(
  db: DB,
  personIds: string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(personIds)]
  if (uniqueIds.some((id) => !validId(id))) return false
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(inArray(persons.id, uniqueIds), isNull(persons.deletedAt)))
  return rows.length === uniqueIds.length
}

async function ownedEndpointCount(
  db: DB,
  userId: string,
  personIds: string[],
): Promise<number> {
  const uniqueIds = [...new Set(personIds)]
  if (uniqueIds.length === 0) return 0
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(inArray(persons.id, uniqueIds), eq(persons.ownerId, userId)))
  return rows.length
}

async function hasWritableTreeContaining(
  db: DB,
  userId: string,
  personIds: string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(personIds)]
  if (uniqueIds.length !== personIds.length || uniqueIds.length === 0) {
    return false
  }
  const rows = await db
    .select({ treeId: treeMembers.treeId, personId: treeMembers.personId })
    .from(treeMembers)
    .where(
      and(
        inArray(treeMembers.personId, uniqueIds),
        isNull(treeMembers.deletedAt),
      ),
    )
  const peopleByTree = new Map<string, Set<string>>()
  for (const row of rows) {
    const people = peopleByTree.get(row.treeId) ?? new Set<string>()
    people.add(row.personId)
    peopleByTree.set(row.treeId, people)
  }
  for (const [treeId, people] of peopleByTree) {
    if (
      people.size === uniqueIds.length
      && canWrite(await treeRole(db, userId, treeId))
    ) {
      return true
    }
  }
  return false
}

async function rolesForTrees(
  db: DB,
  userId: string,
  treeIds: string[],
): Promise<Array<Role | null>> {
  const roles: Array<Role | null> = []
  for (const treeId of new Set(treeIds)) {
    roles.push(await treeRole(db, userId, treeId))
  }
  return roles
}

async function rolesForUnion(
  db: DB,
  userId: string,
  unionId: string,
): Promise<Array<Role | null>> {
  const rows = await db
    .select({ treeId: treeUnions.treeId })
    .from(treeUnions)
    .where(and(eq(treeUnions.unionId, unionId), isNull(treeUnions.deletedAt)))
  return rolesForTrees(
    db,
    userId,
    rows.map((row) => row.treeId),
  )
}

async function rolesForParentRelationship(
  db: DB,
  userId: string,
  relationshipId: string,
): Promise<Array<Role | null>> {
  const rows = await db
    .select({ treeId: treeParentChildRelationships.treeId })
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(
          treeParentChildRelationships.parentChildRelationshipId,
          relationshipId,
        ),
        isNull(treeParentChildRelationships.deletedAt),
      ),
    )
  return rolesForTrees(
    db,
    userId,
    rows.map((row) => row.treeId),
  )
}

async function canWriteExistingUnion(
  db: DB,
  userId: string,
  row: typeof unions.$inferSelect,
): Promise<boolean> {
  const roles = await rolesForUnion(db, userId, row.id)
  if (roles.some(canWrite)) return true
  return (
    (await ownedEndpointCount(db, userId, [
      row.firstPersonId,
      row.secondPersonId,
    ])) === 2
  )
}

async function canWriteExistingParentRelationship(
  db: DB,
  userId: string,
  row: typeof parentChildRelationships.$inferSelect,
): Promise<boolean> {
  const roles = await rolesForParentRelationship(db, userId, row.id)
  if (roles.some(canWrite)) return true
  return (
    (await ownedEndpointCount(db, userId, [
      row.parentPersonId,
      row.childPersonId,
    ])) === 2
  )
}

async function activeTreeHasMembers(
  db: DB,
  treeId: string,
  personIds: string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(personIds)]
  const rows = await db
    .select({ personId: treeMembers.personId })
    .from(treeMembers)
    .where(
      and(
        eq(treeMembers.treeId, treeId),
        inArray(treeMembers.personId, uniqueIds),
        isNull(treeMembers.deletedAt),
      ),
    )
  return (
    rows.length === uniqueIds.length && (await activePeopleExist(db, uniqueIds))
  )
}

async function activeGlobalParentEdges(db: DB): Promise<ParentEdge[]> {
  const rows = await db
    .select()
    .from(parentChildRelationships)
    .where(isNull(parentChildRelationships.deletedAt))
  return rows.map((row) => ({
    id: row.id,
    parentPersonId: row.parentPersonId,
    childPersonId: row.childPersonId,
  }))
}

async function personIsReferencedInTree(
  db: DB,
  treeId: string,
  personId: string,
): Promise<boolean> {
  const unionAssociations = await db
    .select({ unionId: treeUnions.unionId })
    .from(treeUnions)
    .where(and(eq(treeUnions.treeId, treeId), isNull(treeUnions.deletedAt)))
  const unionIds = unionAssociations.map((row) => row.unionId)
  if (unionIds.length > 0) {
    const referencedUnions = await db
      .select({ id: unions.id })
      .from(unions)
      .where(
        and(
          inArray(unions.id, unionIds),
          isNull(unions.deletedAt),
          or(
            eq(unions.firstPersonId, personId),
            eq(unions.secondPersonId, personId),
          ),
        ),
      )
    if (referencedUnions.length > 0) return true
  }

  const parentAssociations = await db
    .select({
      relationshipId: treeParentChildRelationships.parentChildRelationshipId,
    })
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(treeParentChildRelationships.treeId, treeId),
        isNull(treeParentChildRelationships.deletedAt),
      ),
    )
  const relationshipIds = parentAssociations.map((row) => row.relationshipId)
  if (relationshipIds.length === 0) return false
  const referencedRelationships = await db
    .select({ id: parentChildRelationships.id })
    .from(parentChildRelationships)
    .where(
      and(
        inArray(parentChildRelationships.id, relationshipIds),
        isNull(parentChildRelationships.deletedAt),
        or(
          eq(parentChildRelationships.parentPersonId, personId),
          eq(parentChildRelationships.childPersonId, personId),
        ),
      ),
    )
  return referencedRelationships.length > 0
}

function moveAppliedToSkipped(
  applied: SyncAppliedIds,
  skipped: SyncAppliedIds,
  collection: SyncCollection,
  id: string,
): void {
  const index = applied[collection].indexOf(id)
  if (index >= 0) applied[collection].splice(index, 1)
  if (!skipped[collection].includes(id)) skipped[collection].push(id)
}

/** One PostgreSQL statement makes person-owner deletion globally atomic. */
async function tombstonePersonCascade(
  db: DB,
  userId: string,
  personId: string,
  clientUpdatedAt: Date,
): Promise<boolean> {
  const result = await db.execute(sql<{ id: string }>`
    WITH target_person AS MATERIALIZED (
      SELECT ${persons.id} AS id
      FROM ${persons}
      WHERE ${persons.id} = ${personId}
        AND ${persons.ownerId} = ${userId}
        AND ${persons.deletedAt} IS NULL
        AND ${persons.updatedAt} < ${clientUpdatedAt}
    ),
    server_clock AS MATERIALIZED (
      SELECT CURRENT_TIMESTAMP AS value
    ),
    affected_unions AS MATERIALIZED (
      SELECT ${unions.id} AS id
      FROM ${unions}
      WHERE EXISTS (SELECT 1 FROM target_person)
        AND (
          ${unions.firstPersonId} = ${personId}
          OR ${unions.secondPersonId} = ${personId}
        )
    ),
    affected_parent_relationships AS MATERIALIZED (
      SELECT ${parentChildRelationships.id} AS id
      FROM ${parentChildRelationships}
      WHERE EXISTS (SELECT 1 FROM target_person)
        AND (
          ${parentChildRelationships.parentPersonId} = ${personId}
          OR ${parentChildRelationships.childPersonId} = ${personId}
        )
    ),
    tombstoned_memberships AS (
      UPDATE ${treeMembers}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${treeMembers.personId} IN (SELECT id FROM target_person)
        AND ${treeMembers.deletedAt} IS NULL
      RETURNING ${treeMembers.treeId}
    ),
    tombstoned_tree_unions AS (
      UPDATE ${treeUnions}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${treeUnions.unionId} IN (SELECT id FROM affected_unions)
        AND ${treeUnions.deletedAt} IS NULL
      RETURNING ${treeUnions.treeId}
    ),
    tombstoned_tree_parent_relationships AS (
      UPDATE ${treeParentChildRelationships}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${treeParentChildRelationships.parentChildRelationshipId} IN (
        SELECT id FROM affected_parent_relationships
      )
        AND ${treeParentChildRelationships.deletedAt} IS NULL
      RETURNING ${treeParentChildRelationships.treeId}
    ),
    tombstoned_union_events AS (
      UPDATE ${unionEvents}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${unionEvents.unionId} IN (SELECT id FROM affected_unions)
        AND ${unionEvents.deletedAt} IS NULL
      RETURNING ${unionEvents.id}
    ),
    tombstoned_unions AS (
      UPDATE ${unions}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${unions.id} IN (SELECT id FROM affected_unions)
        AND ${unions.deletedAt} IS NULL
      RETURNING ${unions.id}
    ),
    tombstoned_parent_relationships AS (
      UPDATE ${parentChildRelationships}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${parentChildRelationships.id} IN (
        SELECT id FROM affected_parent_relationships
      )
        AND ${parentChildRelationships.deletedAt} IS NULL
      RETURNING ${parentChildRelationships.id}
    ),
    tombstoned_person AS (
      UPDATE ${persons}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${persons.id} IN (SELECT id FROM target_person)
      RETURNING ${persons.id} AS id
    )
    SELECT id FROM tombstoned_person
  `)
  return result.rows.length > 0
}

async function deleteUnionIfOrphaned(
  db: DB,
  unionId: string,
): Promise<boolean> {
  const result = await db.execute(sql<{ id: string }>`
    DELETE FROM ${unions}
    WHERE ${unions.id} = ${unionId}
      AND NOT EXISTS (
        SELECT 1
        FROM ${treeUnions}
        WHERE ${treeUnions.unionId} = ${unionId}
          AND ${treeUnions.deletedAt} IS NULL
      )
    RETURNING ${unions.id} AS id
  `)
  return result.rows.length > 0
}

async function deleteParentRelationshipIfOrphaned(
  db: DB,
  relationshipId: string,
): Promise<boolean> {
  const result = await db.execute(sql<{ id: string }>`
    DELETE FROM ${parentChildRelationships}
    WHERE ${parentChildRelationships.id} = ${relationshipId}
      AND NOT EXISTS (
        SELECT 1
        FROM ${treeParentChildRelationships}
        WHERE ${treeParentChildRelationships.parentChildRelationshipId} = ${relationshipId}
          AND ${treeParentChildRelationships.deletedAt} IS NULL
      )
    RETURNING ${parentChildRelationships.id} AS id
  `)
  return result.rows.length > 0
}

/** POST /api/sync — normalized CRUD with per-record ACL and conditional LWW. */
export async function postSync(request: Request): Promise<Response> {
  let parsedBody: unknown
  try {
    parsedBody = await request.json()
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  const validationTime = new Date()
  if (!isValidSyncPushRequest(parsedBody, validationTime)) {
    return Response.json({ error: "invalid sync payload" }, { status: 400 })
  }

  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const body = parsedBody
  const db = getDB()
  const serverUpdatedAt = sql`CURRENT_TIMESTAMP`
  const applied = emptyAppliedIds()
  const skipped = emptyAppliedIds()

  const forbiddenGlobalDeletes = [
    ["unions", body.unions],
    ["unionEvents", body.unionEvents],
    ["parentChildRelationships", body.parentChildRelationships],
  ] as const
  for (const [collection, wires] of forbiddenGlobalDeletes) {
    if (clientCanTombstone(collection)) continue
    for (const wire of wires) {
      if ("deletedAt" in wire) {
        classify(applied, skipped, collection, wire.id, false)
      }
    }
  }

  // Remove tree-scoped relationship associations before memberships.
  for (const wire of body.treeUnions) {
    if (!("deletedAt" in wire)) continue
    const key = associationKey(wire.treeId, wire.unionId)
    const updatedAt = wireTimestamp(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.unionId)
      || !updatedAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
    ) {
      classify(applied, skipped, "treeUnions", key, false)
      continue
    }
    const rows = await db
      .update(treeUnions)
      .set({ deletedAt: serverUpdatedAt, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(treeUnions.treeId, wire.treeId),
          eq(treeUnions.unionId, wire.unionId),
          lt(treeUnions.updatedAt, updatedAt),
        ),
      )
      .returning({ treeId: treeUnions.treeId })
    classify(applied, skipped, "treeUnions", key, rows.length > 0)
  }
  for (const wire of body.treeParentChildRelationships) {
    if (!("deletedAt" in wire)) continue
    const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
    const updatedAt = wireTimestamp(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.parentChildRelationshipId)
      || !updatedAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const rows = await db
      .update(treeParentChildRelationships)
      .set({ deletedAt: serverUpdatedAt, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(treeParentChildRelationships.treeId, wire.treeId),
          eq(
            treeParentChildRelationships.parentChildRelationshipId,
            wire.parentChildRelationshipId,
          ),
          lt(treeParentChildRelationships.updatedAt, updatedAt),
        ),
      )
      .returning({ treeId: treeParentChildRelationships.treeId })
    classify(
      applied,
      skipped,
      "treeParentChildRelationships",
      key,
      rows.length > 0,
    )
  }

  for (const wire of body.treeMembers) {
    if (!("deletedAt" in wire)) continue
    const key = associationKey(wire.treeId, wire.personId)
    const updatedAt = wireTimestamp(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.personId)
      || !updatedAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
      || (await personIsReferencedInTree(db, wire.treeId, wire.personId))
    ) {
      classify(applied, skipped, "treeMembers", key, false)
      continue
    }
    const rows = await db
      .update(treeMembers)
      .set({ deletedAt: serverUpdatedAt, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(treeMembers.treeId, wire.treeId),
          eq(treeMembers.personId, wire.personId),
          lt(treeMembers.updatedAt, updatedAt),
        ),
      )
      .returning({ treeId: treeMembers.treeId })
    classify(applied, skipped, "treeMembers", key, rows.length > 0)
  }

  for (const wire of body.persons) {
    if (!("deletedAt" in wire)) continue
    const updatedAt = wireTimestamp(wire)
    if (!updatedAt) {
      classify(applied, skipped, "persons", wire.id, false)
      continue
    }
    classify(
      applied,
      skipped,
      "persons",
      wire.id,
      await tombstonePersonCascade(db, me.id, wire.id, updatedAt),
    )
  }

  for (const wire of body.trees) {
    if (!("deletedAt" in wire)) continue
    const updatedAt = wireTimestamp(wire)
    if (!updatedAt) {
      classify(applied, skipped, "trees", wire.id, false)
      continue
    }
    const rows = await db
      .update(trees)
      .set({ deletedAt: serverUpdatedAt, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(trees.id, wire.id),
          eq(trees.ownerId, me.id),
          lt(trees.updatedAt, updatedAt),
        ),
      )
      .returning({ id: trees.id })
    classify(applied, skipped, "trees", wire.id, rows.length > 0)
  }

  // Upserts run in foreign-key order: roots, memberships, global facts, links.
  for (const wire of body.trees) {
    if ("deletedAt" in wire) continue
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.id)
      || typeof wire.name !== "string"
      || !updatedAt
      || !createdAt
    ) {
      classify(applied, skipped, "trees", wire.id, false)
      continue
    }
    const existing = await db.query.trees.findFirst({
      where: eq(trees.id, wire.id),
    })
    if (!existing) {
      const rows = await db
        .insert(trees)
        .values({
          id: wire.id,
          ownerId: me.id,
          name: wire.name,
          createdAt,
          updatedAt: serverUpdatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: trees.id })
      classify(applied, skipped, "trees", wire.id, rows.length > 0)
      continue
    }
    if (existing.ownerId !== me.id || existing.deletedAt) {
      classify(applied, skipped, "trees", wire.id, false)
      continue
    }
    const rows = await db
      .update(trees)
      .set({ name: wire.name, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(trees.id, wire.id),
          eq(trees.ownerId, me.id),
          isNull(trees.deletedAt),
          lt(trees.updatedAt, updatedAt),
        ),
      )
      .returning({ id: trees.id })
    classify(applied, skipped, "trees", wire.id, rows.length > 0)
  }

  for (const wire of body.persons) {
    if ("deletedAt" in wire) continue
    const updatedAt = wireTimestamp(wire)
    if (
      !validId(wire.id)
      || typeof wire.name !== "string"
      || !isOptionalString(wire.dob)
      || !isOptionalString(wire.dod)
      || (wire.gender !== undefined && !GENDERS.has(wire.gender))
      || !isOptionalString(wire.location)
      || !isOptionalString(wire.photo)
      || !updatedAt
    ) {
      classify(applied, skipped, "persons", wire.id, false)
      continue
    }
    const existing = await db.query.persons.findFirst({
      where: eq(persons.id, wire.id),
    })
    if (!existing) {
      const rows = await db
        .insert(persons)
        .values({
          id: wire.id,
          ownerId: me.id,
          name: wire.name,
          dob: wire.dob ?? null,
          dod: wire.dod ?? null,
          gender: wire.gender ?? null,
          location: wire.location ?? null,
          photo: wire.photo ?? null,
          updatedAt: serverUpdatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: persons.id })
      classify(applied, skipped, "persons", wire.id, rows.length > 0)
      continue
    }
    if (existing.deletedAt || !canWrite(await personRole(db, me.id, wire.id))) {
      classify(applied, skipped, "persons", wire.id, false)
      continue
    }
    const rows = await db
      .update(persons)
      .set({
        name: wire.name,
        dob: wire.dob ?? null,
        dod: wire.dod ?? null,
        gender: wire.gender ?? null,
        location: wire.location ?? null,
        photo: wire.photo ?? null,
        updatedAt: serverUpdatedAt,
      })
      .where(
        and(
          eq(persons.id, wire.id),
          isNull(persons.deletedAt),
          lt(persons.updatedAt, updatedAt),
        ),
      )
      .returning({ id: persons.id })
    classify(applied, skipped, "persons", wire.id, rows.length > 0)
  }

  for (const wire of body.treeMembers) {
    if ("deletedAt" in wire) continue
    const key = associationKey(wire.treeId, wire.personId)
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.personId)
      || !updatedAt
      || !createdAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
      || !(await activePeopleExist(db, [wire.personId]))
    ) {
      classify(applied, skipped, "treeMembers", key, false)
      continue
    }
    const existing = await db.query.treeMembers.findFirst({
      where: and(
        eq(treeMembers.treeId, wire.treeId),
        eq(treeMembers.personId, wire.personId),
      ),
    })
    if (
      (!existing || existing.deletedAt)
      && !canWrite(await personRole(db, me.id, wire.personId))
    ) {
      classify(applied, skipped, "treeMembers", key, false)
      continue
    }
    const rows = await db
      .insert(treeMembers)
      .values({
        treeId: wire.treeId,
        personId: wire.personId,
        createdAt,
        updatedAt: serverUpdatedAt,
      })
      .onConflictDoUpdate({
        target: [treeMembers.treeId, treeMembers.personId],
        set: { deletedAt: null, updatedAt: serverUpdatedAt },
        setWhere: lt(treeMembers.updatedAt, updatedAt),
      })
      .returning({ treeId: treeMembers.treeId })
    classify(applied, skipped, "treeMembers", key, rows.length > 0)
  }

  const createdUnionIds = new Set<string>()
  for (const wire of body.unions) {
    if ("deletedAt" in wire) continue
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.id)
      || !validId(wire.firstPersonId)
      || !validId(wire.secondPersonId)
      || !isCanonicalUnion(wire.firstPersonId, wire.secondPersonId)
      || !updatedAt
      || !createdAt
      || !(await activePeopleExist(db, [
        wire.firstPersonId,
        wire.secondPersonId,
      ]))
    ) {
      classify(applied, skipped, "unions", wire.id, false)
      continue
    }
    const existing = await db.query.unions.findFirst({
      where: eq(unions.id, wire.id),
    })
    if (!existing) {
      if (
        !(await hasWritableTreeContaining(db, me.id, [
          wire.firstPersonId,
          wire.secondPersonId,
        ]))
      ) {
        classify(applied, skipped, "unions", wire.id, false)
        continue
      }
      const rows = await db
        .insert(unions)
        .values({
          id: wire.id,
          firstPersonId: wire.firstPersonId,
          secondPersonId: wire.secondPersonId,
          createdAt,
          updatedAt: serverUpdatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: unions.id })
      if (rows.length > 0) createdUnionIds.add(wire.id)
      classify(applied, skipped, "unions", wire.id, rows.length > 0)
      continue
    }
    if (
      existing.deletedAt
      || existing.firstPersonId !== wire.firstPersonId
      || existing.secondPersonId !== wire.secondPersonId
      || !(await canWriteExistingUnion(db, me.id, existing))
    ) {
      classify(applied, skipped, "unions", wire.id, false)
      continue
    }
    const rows = await db
      .update(unions)
      .set({ updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(unions.id, wire.id),
          eq(unions.firstPersonId, wire.firstPersonId),
          eq(unions.secondPersonId, wire.secondPersonId),
          isNull(unions.deletedAt),
          lt(unions.updatedAt, updatedAt),
        ),
      )
      .returning({ id: unions.id })
    classify(applied, skipped, "unions", wire.id, rows.length > 0)
  }

  const createdParentRelationshipIds = new Set<string>()
  for (const wire of body.parentChildRelationships) {
    if ("deletedAt" in wire) continue
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.id)
      || !validId(wire.parentPersonId)
      || !validId(wire.childPersonId)
      || wire.parentPersonId === wire.childPersonId
      || !PARENT_RELATIONSHIP_TYPES.has(wire.type)
      || !updatedAt
      || !createdAt
      || !(await activePeopleExist(db, [
        wire.parentPersonId,
        wire.childPersonId,
      ]))
    ) {
      classify(applied, skipped, "parentChildRelationships", wire.id, false)
      continue
    }
    const existing = await db.query.parentChildRelationships.findFirst({
      where: eq(parentChildRelationships.id, wire.id),
    })
    if (!existing) {
      if (
        !(await hasWritableTreeContaining(db, me.id, [
          wire.parentPersonId,
          wire.childPersonId,
        ]))
      ) {
        classify(applied, skipped, "parentChildRelationships", wire.id, false)
        continue
      }
      const validation = validateParentAssociation(
        await activeGlobalParentEdges(db),
        {
          id: wire.id,
          parentPersonId: wire.parentPersonId,
          childPersonId: wire.childPersonId,
        },
      )
      if (validation !== "valid") {
        classify(applied, skipped, "parentChildRelationships", wire.id, false)
        continue
      }
      const rows = await db
        .insert(parentChildRelationships)
        .values({
          id: wire.id,
          parentPersonId: wire.parentPersonId,
          childPersonId: wire.childPersonId,
          type: wire.type,
          createdAt,
          updatedAt: serverUpdatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: parentChildRelationships.id })
      if (rows.length > 0) createdParentRelationshipIds.add(wire.id)
      classify(
        applied,
        skipped,
        "parentChildRelationships",
        wire.id,
        rows.length > 0,
      )
      continue
    }
    if (
      existing.deletedAt
      || existing.parentPersonId !== wire.parentPersonId
      || existing.childPersonId !== wire.childPersonId
      || !(await canWriteExistingParentRelationship(db, me.id, existing))
    ) {
      classify(applied, skipped, "parentChildRelationships", wire.id, false)
      continue
    }
    const rows = await db
      .update(parentChildRelationships)
      .set({ type: wire.type, updatedAt: serverUpdatedAt })
      .where(
        and(
          eq(parentChildRelationships.id, wire.id),
          eq(parentChildRelationships.parentPersonId, wire.parentPersonId),
          eq(parentChildRelationships.childPersonId, wire.childPersonId),
          isNull(parentChildRelationships.deletedAt),
          lt(parentChildRelationships.updatedAt, updatedAt),
        ),
      )
      .returning({ id: parentChildRelationships.id })
    classify(
      applied,
      skipped,
      "parentChildRelationships",
      wire.id,
      rows.length > 0,
    )
  }

  const createdEventIdsByUnion = new Map<string, string[]>()
  for (const wire of body.unionEvents) {
    if ("deletedAt" in wire) continue
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.id)
      || !validId(wire.unionId)
      || !UNION_EVENT_TYPES.has(wire.type)
      || (wire.eventDate !== undefined && !isValidIsoDate(wire.eventDate))
      || !updatedAt
      || !createdAt
    ) {
      classify(applied, skipped, "unionEvents", wire.id, false)
      continue
    }
    const union = await db.query.unions.findFirst({
      where: and(eq(unions.id, wire.unionId), isNull(unions.deletedAt)),
    })
    if (!union) {
      classify(applied, skipped, "unionEvents", wire.id, false)
      continue
    }
    const existing = await db.query.unionEvents.findFirst({
      where: eq(unionEvents.id, wire.id),
    })
    if (!existing) {
      if (
        !createdUnionIds.has(union.id)
        && !(await canWriteExistingUnion(db, me.id, union))
      ) {
        classify(applied, skipped, "unionEvents", wire.id, false)
        continue
      }
      const rows = await db
        .insert(unionEvents)
        .values({
          id: wire.id,
          unionId: wire.unionId,
          type: wire.type,
          eventDate: wire.eventDate ?? null,
          createdAt,
          updatedAt: serverUpdatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: unionEvents.id })
      if (rows.length > 0) {
        const eventIds = createdEventIdsByUnion.get(wire.unionId) ?? []
        eventIds.push(wire.id)
        createdEventIdsByUnion.set(wire.unionId, eventIds)
      }
      classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
      continue
    }
    if (
      existing.deletedAt
      || existing.unionId !== wire.unionId
      || !(await canWriteExistingUnion(db, me.id, union))
    ) {
      classify(applied, skipped, "unionEvents", wire.id, false)
      continue
    }
    const rows = await db
      .update(unionEvents)
      .set({
        type: wire.type,
        eventDate: wire.eventDate ?? null,
        updatedAt: serverUpdatedAt,
      })
      .where(
        and(
          eq(unionEvents.id, wire.id),
          eq(unionEvents.unionId, wire.unionId),
          isNull(unionEvents.deletedAt),
          lt(unionEvents.updatedAt, updatedAt),
        ),
      )
      .returning({ id: unionEvents.id })
    classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
  }

  const associatedUnionIds = new Set<string>()
  for (const wire of body.treeUnions) {
    if ("deletedAt" in wire) continue
    const key = associationKey(wire.treeId, wire.unionId)
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.unionId)
      || !updatedAt
      || !createdAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
    ) {
      classify(applied, skipped, "treeUnions", key, false)
      continue
    }
    const union = await db.query.unions.findFirst({
      where: and(eq(unions.id, wire.unionId), isNull(unions.deletedAt)),
    })
    if (
      !union
      || !(await activeTreeHasMembers(db, wire.treeId, [
        union.firstPersonId,
        union.secondPersonId,
      ]))
    ) {
      classify(applied, skipped, "treeUnions", key, false)
      continue
    }
    const existing = await db.query.treeUnions.findFirst({
      where: and(
        eq(treeUnions.treeId, wire.treeId),
        eq(treeUnions.unionId, wire.unionId),
      ),
    })
    if (
      !existing
      && !createdUnionIds.has(union.id)
      && !(await canWriteExistingUnion(db, me.id, union))
    ) {
      classify(applied, skipped, "treeUnions", key, false)
      continue
    }
    const rows = await db
      .insert(treeUnions)
      .values({
        treeId: wire.treeId,
        unionId: wire.unionId,
        createdAt,
        updatedAt: serverUpdatedAt,
      })
      .onConflictDoUpdate({
        target: [treeUnions.treeId, treeUnions.unionId],
        set: { deletedAt: null, updatedAt: serverUpdatedAt },
        setWhere: lt(treeUnions.updatedAt, updatedAt),
      })
      .returning({ treeId: treeUnions.treeId })
    if (rows.length > 0) associatedUnionIds.add(wire.unionId)
    classify(applied, skipped, "treeUnions", key, rows.length > 0)
  }

  const associatedParentRelationshipIds = new Set<string>()
  for (const wire of body.treeParentChildRelationships) {
    if ("deletedAt" in wire) continue
    const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.parentChildRelationshipId)
      || !updatedAt
      || !createdAt
      || !canWrite(await treeRole(db, me.id, wire.treeId))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const relationship = await db.query.parentChildRelationships.findFirst({
      where: and(
        eq(parentChildRelationships.id, wire.parentChildRelationshipId),
        isNull(parentChildRelationships.deletedAt),
      ),
    })
    if (
      !relationship
      || !(await activeTreeHasMembers(db, wire.treeId, [
        relationship.parentPersonId,
        relationship.childPersonId,
      ]))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const existing = await db.query.treeParentChildRelationships.findFirst({
      where: and(
        eq(treeParentChildRelationships.treeId, wire.treeId),
        eq(
          treeParentChildRelationships.parentChildRelationshipId,
          wire.parentChildRelationshipId,
        ),
      ),
    })
    if (
      !existing
      && !createdParentRelationshipIds.has(relationship.id)
      && !(await canWriteExistingParentRelationship(db, me.id, relationship))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const validation = validateParentAssociation(
      await activeGlobalParentEdges(db),
      {
        id: relationship.id,
        parentPersonId: relationship.parentPersonId,
        childPersonId: relationship.childPersonId,
      },
    )
    if (validation !== "valid") {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const rows = await db
      .insert(treeParentChildRelationships)
      .values({
        treeId: wire.treeId,
        parentChildRelationshipId: wire.parentChildRelationshipId,
        createdAt,
        updatedAt: serverUpdatedAt,
      })
      .onConflictDoUpdate({
        target: [
          treeParentChildRelationships.treeId,
          treeParentChildRelationships.parentChildRelationshipId,
        ],
        set: { deletedAt: null, updatedAt: serverUpdatedAt },
        setWhere: lt(treeParentChildRelationships.updatedAt, updatedAt),
      })
      .returning({ treeId: treeParentChildRelationships.treeId })
    if (rows.length > 0) {
      associatedParentRelationshipIds.add(wire.parentChildRelationshipId)
    }
    classify(
      applied,
      skipped,
      "treeParentChildRelationships",
      key,
      rows.length > 0,
    )
  }

  for (const unionId of createdUnionIds) {
    if (associatedUnionIds.has(unionId)) continue
    if (!(await deleteUnionIfOrphaned(db, unionId))) continue
    moveAppliedToSkipped(applied, skipped, "unions", unionId)
    for (const eventId of createdEventIdsByUnion.get(unionId) ?? []) {
      moveAppliedToSkipped(applied, skipped, "unionEvents", eventId)
    }
  }
  for (const relationshipId of createdParentRelationshipIds) {
    if (associatedParentRelationshipIds.has(relationshipId)) continue
    if (!(await deleteParentRelationshipIfOrphaned(db, relationshipId))) {
      continue
    }
    moveAppliedToSkipped(
      applied,
      skipped,
      "parentChildRelationships",
      relationshipId,
    )
  }

  const response: SyncPushResponse = {
    applied,
    skipped,
    serverTime: new Date().toISOString(),
  }
  return Response.json(response)
}
