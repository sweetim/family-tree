import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { getDB } from "../../db/index"
import {
  mutationReceipts,
  parentChildRelationships,
  persons,
  syncChanges,
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type {
  SyncAppliedIds,
  SyncMutationResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncRecordSet,
} from "../../sync/types"
import type {
  Gender,
  ParentChildRelationshipType,
  UnionEventType,
} from "../../types"
import { canWrite, personRole, type Role, treeRole } from "../acl"
import {
  deletePhoto,
  isPhotoDataUrl,
  normalizePhoto,
  normalizePhotoUpdate,
} from "../blob"
import { MAX_SYNC_BODY_BYTES, readJsonBody } from "../request"
import { requireSession } from "../session"
import {
  associationKey,
  clientCanTombstone,
  isCanonicalUnion,
  isValidIsoDate,
  isValidSyncId,
  isValidSyncPushRequest,
} from "../sync-validation"
import {
  parentRelationshipToWire,
  personToWire,
  treeMemberToWire,
  treeParentRelationshipToWire,
  treeToWire,
  treeUnionToWire,
  unionEventToWire,
  unionToWire,
} from "./wire"

type SyncCollection = keyof SyncAppliedIds
type RoleForTree = (treeId: string) => Promise<Role | null>
type ActivePeopleExist = (personIds: string[]) => Promise<boolean>
type CascadedTreeReferences = {
  unionIds: Set<string>
  parentRelationshipIds: Set<string>
  treeUnionKeys: Set<string>
  treeParentRelationshipKeys: Set<string>
}

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

function requestIds(body: SyncPushRequest): SyncAppliedIds {
  return {
    persons: body.persons.map((wire) => wire.id),
    trees: body.trees.map((wire) => wire.id),
    treeMembers: body.treeMembers.map((wire) =>
      associationKey(wire.treeId, wire.personId),
    ),
    unions: body.unions.map((wire) => wire.id),
    unionEvents: body.unionEvents.map((wire) => wire.id),
    treeUnions: body.treeUnions.map((wire) =>
      associationKey(wire.treeId, wire.unionId),
    ),
    parentChildRelationships: body.parentChildRelationships.map(
      (wire) => wire.id,
    ),
    treeParentChildRelationships: body.treeParentChildRelationships.map(
      (wire) => associationKey(wire.treeId, wire.parentChildRelationshipId),
    ),
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

function wireRevision(wire: { revision?: number }): number | null {
  return Number.isSafeInteger(wire.revision) && (wire.revision ?? 0) > 0
    ? (wire.revision as number)
    : null
}

function hasClassifiedRecords(ids: SyncAppliedIds): boolean {
  return Object.values(ids).some((records) => records.length > 0)
}

function isValidMutationId(value: string | null): value is string {
  return Boolean(value && isValidSyncId(value))
}

type ConflictResponse = SyncMutationResponse

async function collectAuthoritativeConflictRecords(
  db: DB,
  body: SyncPushRequest,
): Promise<SyncRecordSet> {
  const changes = await collectMutationChanges(db, body, new Map())
  const result = emptyRecordSet()
  for (const records of changes.values()) {
    for (const collection of Object.keys(result) as Array<
      keyof SyncRecordSet
    >) {
      const existing = new Set(
        result[collection].map((wire) => JSON.stringify(wire)),
      )
      for (const wire of records[collection]) {
        const key = JSON.stringify(wire)
        if (!existing.has(key)) {
          result[collection].push(wire as never)
          existing.add(key)
        }
      }
    }
  }
  return result
}

function emptyRecordSet(): SyncRecordSet {
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

function emptyCascadedTreeReferences(): CascadedTreeReferences {
  return {
    unionIds: new Set(),
    parentRelationshipIds: new Set(),
    treeUnionKeys: new Set(),
    treeParentRelationshipKeys: new Set(),
  }
}

async function collectMutationChanges(
  db: DB,
  body: SyncPushRequest,
  parentAliases: ReadonlyMap<
    string,
    {
      id: string
      revision: number
      type: ParentChildRelationshipType
    }
  >,
  cascadedReferences: CascadedTreeReferences = emptyCascadedTreeReferences(),
): Promise<Map<string, SyncRecordSet>> {
  const personIds = new Set([
    ...body.persons.map((wire) => wire.id),
    ...body.treeMembers.map((wire) => wire.personId),
  ])
  const deletedPersonIds = body.persons
    .filter((wire) => "deletedAt" in wire)
    .map((wire) => wire.id)
  const deletedPersonIdSet = new Set(deletedPersonIds)
  const explicitMemberKeys = new Set(
    body.treeMembers.map((wire) => associationKey(wire.treeId, wire.personId)),
  )
  const explicitTreeUnionKeys = new Set([
    ...body.treeUnions.map((wire) => associationKey(wire.treeId, wire.unionId)),
    ...cascadedReferences.treeUnionKeys,
  ])
  const explicitTreeParentKeys = new Set([
    ...body.treeParentChildRelationships.map((wire) =>
      associationKey(
        wire.treeId,
        parentAliases.get(wire.parentChildRelationshipId)?.id
          ?? wire.parentChildRelationshipId,
      ),
    ),
    ...cascadedReferences.treeParentRelationshipKeys,
  ])
  const unionIds = new Set([
    ...body.unions.map((wire) => wire.id),
    ...body.unionEvents.flatMap((wire) =>
      "unionId" in wire ? [wire.unionId] : [],
    ),
    ...body.treeUnions.map((wire) => wire.unionId),
    ...cascadedReferences.unionIds,
  ])
  const parentIds = new Set([
    ...body.parentChildRelationships.map((wire) => wire.id),
    ...body.treeParentChildRelationships.map(
      (wire) => wire.parentChildRelationshipId,
    ),
    ...cascadedReferences.parentRelationshipIds,
  ])
  for (const alias of parentAliases.values()) parentIds.add(alias.id)

  if (deletedPersonIds.length > 0) {
    const [affectedUnions, affectedParents] = await Promise.all([
      db
        .select({ id: unions.id })
        .from(unions)
        .where(
          or(
            inArray(unions.firstPersonId, deletedPersonIds),
            inArray(unions.secondPersonId, deletedPersonIds),
          ),
        ),
      db
        .select({ id: parentChildRelationships.id })
        .from(parentChildRelationships)
        .where(
          or(
            inArray(parentChildRelationships.parentPersonId, deletedPersonIds),
            inArray(parentChildRelationships.childPersonId, deletedPersonIds),
          ),
        ),
    ])
    for (const row of affectedUnions) unionIds.add(row.id)
    for (const row of affectedParents) parentIds.add(row.id)
  }

  const personIdList = [...personIds]
  const unionIdList = [...unionIds]
  const parentIdList = [...parentIds]
  const changedTreeIds = [...new Set(body.trees.map((wire) => wire.id))]
  const [
    personRows,
    treeRows,
    memberRows,
    unionRows,
    eventRows,
    treeUnionRows,
    parentRows,
    treeParentRows,
  ] = await Promise.all([
    personIdList.length > 0
      ? db.select().from(persons).where(inArray(persons.id, personIdList))
      : [],
    changedTreeIds.length > 0
      ? db.select().from(trees).where(inArray(trees.id, changedTreeIds))
      : [],
    personIdList.length > 0
      ? db
          .select()
          .from(treeMembers)
          .where(inArray(treeMembers.personId, personIdList))
      : [],
    unionIdList.length > 0
      ? db.select().from(unions).where(inArray(unions.id, unionIdList))
      : [],
    unionIdList.length > 0
      ? db
          .select()
          .from(unionEvents)
          .where(inArray(unionEvents.unionId, unionIdList))
      : [],
    unionIdList.length > 0
      ? db
          .select()
          .from(treeUnions)
          .where(inArray(treeUnions.unionId, unionIdList))
      : [],
    parentIdList.length > 0
      ? db
          .select()
          .from(parentChildRelationships)
          .where(inArray(parentChildRelationships.id, parentIdList))
      : [],
    parentIdList.length > 0
      ? db
          .select()
          .from(treeParentChildRelationships)
          .where(
            inArray(
              treeParentChildRelationships.parentChildRelationshipId,
              parentIdList,
            ),
          )
      : [],
  ])

  const changesByTree = new Map<string, SyncRecordSet>()
  const peopleById = new Map(personRows.map((row) => [row.id, row]))
  const unionsById = new Map(unionRows.map((row) => [row.id, row]))
  const eventsByUnion = new Map<string, typeof eventRows>()
  for (const event of eventRows) {
    const events = eventsByUnion.get(event.unionId) ?? []
    events.push(event)
    eventsByUnion.set(event.unionId, events)
  }
  const parentsById = new Map(parentRows.map((row) => [row.id, row]))
  const recordsFor = (treeId: string): SyncRecordSet => {
    const existing = changesByTree.get(treeId)
    if (existing) return existing
    const created = emptyRecordSet()
    changesByTree.set(treeId, created)
    return created
  }
  for (const row of treeRows) recordsFor(row.id).trees.push(treeToWire(row))
  for (const row of memberRows) {
    const explicit = explicitMemberKeys.has(
      associationKey(row.treeId, row.personId),
    )
    if (row.deletedAt && !explicit && !deletedPersonIdSet.has(row.personId)) {
      continue
    }
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIdSet.has(row.personId)) {
      records.treeMembers.push(treeMemberToWire(row))
    }
    const person = peopleById.get(row.personId)
    if (
      person
      && (!row.deletedAt || deletedPersonIdSet.has(row.personId))
      && !records.persons.some((wire) => wire.id === person.id)
    ) {
      records.persons.push(personToWire(person))
    }
  }
  for (const row of treeUnionRows) {
    const explicit = explicitTreeUnionKeys.has(
      associationKey(row.treeId, row.unionId),
    )
    if (row.deletedAt && !explicit && deletedPersonIds.length === 0) continue
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIds.length > 0) {
      records.treeUnions.push(treeUnionToWire(row))
    }
    const union =
      !row.deletedAt || deletedPersonIds.length > 0
        ? unionsById.get(row.unionId)
        : undefined
    if (union && !records.unions.some((wire) => wire.id === union.id)) {
      records.unions.push(unionToWire(union))
      records.unionEvents.push(
        ...(eventsByUnion.get(union.id) ?? []).map(unionEventToWire),
      )
    }
  }
  for (const row of treeParentRows) {
    const explicit = explicitTreeParentKeys.has(
      associationKey(row.treeId, row.parentChildRelationshipId),
    )
    if (row.deletedAt && !explicit && deletedPersonIds.length === 0) continue
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIds.length > 0) {
      records.treeParentChildRelationships.push(
        treeParentRelationshipToWire(row),
      )
    }
    const relationship =
      !row.deletedAt || deletedPersonIds.length > 0
        ? parentsById.get(row.parentChildRelationshipId)
        : undefined
    if (
      relationship
      && !records.parentChildRelationships.some(
        (wire) => wire.id === relationship.id,
      )
    ) {
      records.parentChildRelationships.push(
        parentRelationshipToWire(relationship),
      )
    }
  }
  return changesByTree
}

function validId(value: string): boolean {
  return isValidSyncId(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function isOptionalPhoto(value: unknown): boolean {
  return value === null || isOptionalString(value)
}

function isParentGraphConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && error.code === "23514") return true
  return "cause" in error && isParentGraphConstraintError(error.cause)
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
  personIds: string[],
  roleForTree: RoleForTree,
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
      && canWrite(await roleForTree(treeId))
    ) {
      return true
    }
  }
  return false
}

async function rolesForTrees(
  treeIds: string[],
  roleForTree: RoleForTree,
): Promise<Array<Role | null>> {
  return Promise.all([...new Set(treeIds)].map(roleForTree))
}

async function rolesForUnion(
  db: DB,
  unionId: string,
  roleForTree: RoleForTree,
): Promise<Array<Role | null>> {
  const rows = await db
    .select({ treeId: treeUnions.treeId })
    .from(treeUnions)
    .where(and(eq(treeUnions.unionId, unionId), isNull(treeUnions.deletedAt)))
  return rolesForTrees(
    rows.map((row) => row.treeId),
    roleForTree,
  )
}

async function rolesForParentRelationship(
  db: DB,
  relationshipId: string,
  roleForTree: RoleForTree,
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
    rows.map((row) => row.treeId),
    roleForTree,
  )
}

async function canWriteExistingUnion(
  db: DB,
  userId: string,
  row: typeof unions.$inferSelect,
  roleForTree: RoleForTree,
): Promise<boolean> {
  const roles = await rolesForUnion(db, row.id, roleForTree)
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
  roleForTree: RoleForTree,
): Promise<boolean> {
  const roles = await rolesForParentRelationship(db, row.id, roleForTree)
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
  activePeopleExist: ActivePeopleExist,
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
    rows.length === uniqueIds.length && (await activePeopleExist(uniqueIds))
  )
}

async function tombstonePersonReferencesInTree(
  db: DB,
  treeId: string,
  personId: string,
  serverTime: Date,
): Promise<{ unionIds: string[]; parentRelationshipIds: string[] }> {
  const unionAssociations = await db
    .select({ id: treeUnions.unionId })
    .from(treeUnions)
    .innerJoin(unions, eq(unions.id, treeUnions.unionId))
    .where(
      and(
        eq(treeUnions.treeId, treeId),
        isNull(treeUnions.deletedAt),
        isNull(unions.deletedAt),
        or(
          eq(unions.firstPersonId, personId),
          eq(unions.secondPersonId, personId),
        ),
      ),
    )
  const parentAssociations = await db
    .select({ id: treeParentChildRelationships.parentChildRelationshipId })
    .from(treeParentChildRelationships)
    .innerJoin(
      parentChildRelationships,
      eq(
        parentChildRelationships.id,
        treeParentChildRelationships.parentChildRelationshipId,
      ),
    )
    .where(
      and(
        eq(treeParentChildRelationships.treeId, treeId),
        isNull(treeParentChildRelationships.deletedAt),
        isNull(parentChildRelationships.deletedAt),
        or(
          eq(parentChildRelationships.parentPersonId, personId),
          eq(parentChildRelationships.childPersonId, personId),
        ),
      ),
    )
  const unionIds = unionAssociations.map((row) => row.id)
  const parentRelationshipIds = parentAssociations.map((row) => row.id)
  await Promise.all([
    unionIds.length > 0
      ? db
          .update(treeUnions)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeUnions.revision} + 1`,
          })
          .where(
            and(
              eq(treeUnions.treeId, treeId),
              inArray(treeUnions.unionId, unionIds),
              isNull(treeUnions.deletedAt),
            ),
          )
      : Promise.resolve(),
    parentRelationshipIds.length > 0
      ? db
          .update(treeParentChildRelationships)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeParentChildRelationships.revision} + 1`,
          })
          .where(
            and(
              eq(treeParentChildRelationships.treeId, treeId),
              inArray(
                treeParentChildRelationships.parentChildRelationshipId,
                parentRelationshipIds,
              ),
              isNull(treeParentChildRelationships.deletedAt),
            ),
          )
      : Promise.resolve(),
  ])
  return { unionIds, parentRelationshipIds }
}

/** One PostgreSQL statement makes person-owner deletion globally atomic. */
async function tombstonePersonCascade(
  db: DB,
  userId: string,
  personId: string,
  expectedRevision: number,
  serverTime: Date,
  photosToDeleteAfterCommit: Set<string>,
): Promise<boolean> {
  const result = await db.execute(sql<{ id: string; photo: string | null }>`
    WITH     server_clock AS MATERIALIZED (
      SELECT ${serverTime}::timestamptz AS value
    ),
    target_person AS MATERIALIZED (
      UPDATE ${persons}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${persons.id} = ${personId}
        AND ${persons.ownerId} = ${userId}
        AND ${persons.deletedAt} IS NULL
        AND ${persons.revision} = ${expectedRevision}
      RETURNING ${persons.id} AS id, ${persons.photo} AS photo
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
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeMembers.personId} IN (SELECT id FROM target_person)
        AND ${treeMembers.deletedAt} IS NULL
      RETURNING ${treeMembers.treeId}
    ),
    tombstoned_tree_unions AS (
      UPDATE ${treeUnions}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeUnions.unionId} IN (SELECT id FROM affected_unions)
        AND ${treeUnions.deletedAt} IS NULL
      RETURNING ${treeUnions.treeId}
    ),
    tombstoned_tree_parent_relationships AS (
      UPDATE ${treeParentChildRelationships}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeParentChildRelationships.parentChildRelationshipId} IN (
        SELECT id FROM affected_parent_relationships
      )
        AND ${treeParentChildRelationships.deletedAt} IS NULL
      RETURNING ${treeParentChildRelationships.treeId}
    ),
    tombstoned_union_events AS (
      UPDATE ${unionEvents}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${unionEvents.unionId} IN (SELECT id FROM affected_unions)
        AND ${unionEvents.deletedAt} IS NULL
      RETURNING ${unionEvents.id}
    ),
    tombstoned_unions AS (
      UPDATE ${unions}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${unions.id} IN (SELECT id FROM affected_unions)
        AND ${unions.deletedAt} IS NULL
      RETURNING ${unions.id}
    ),
    tombstoned_parent_relationships AS (
      UPDATE ${parentChildRelationships}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${parentChildRelationships.id} IN (
        SELECT id FROM affected_parent_relationships
      )
        AND ${parentChildRelationships.deletedAt} IS NULL
      RETURNING ${parentChildRelationships.id}
    )
    SELECT id, photo FROM target_person
  `)
  const previousPhoto = result.rows[0]?.photo as string | null | undefined
  if (previousPhoto && !isPhotoDataUrl(previousPhoto)) {
    photosToDeleteAfterCommit.add(previousPhoto)
  }
  return result.rows.length > 0
}

/** POST /api/sync — normalized CRUD with per-record ACL and conditional LWW. */
export async function postSync(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const parsed = await readJsonBody(request, MAX_SYNC_BODY_BYTES)
  if (!parsed.ok) {
    if (parsed.error === "too-large") {
      return Response.json({ error: "sync payload too large" }, { status: 413 })
    }
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  const parsedBody = parsed.value
  const validationTime = new Date()
  if (!isValidSyncPushRequest(parsedBody, validationTime)) {
    return Response.json({ error: "invalid sync payload" }, { status: 400 })
  }

  const body = parsedBody
  const mutationIdHeader = request.headers.get("x-sync-mutation-id")
  const mutationId = isValidMutationId(mutationIdHeader)
    ? mutationIdHeader
    : null
  if (mutationIdHeader && !mutationId) {
    return Response.json({ error: "invalid mutation id" }, { status: 400 })
  }
  const rootDb = getDB()
  let conflictResponse: ConflictResponse | undefined
  let committedResponse: Response | undefined
  const uploadedPhotos = new Set<string>()
  const photosToDeleteAfterCommit = new Set<string>()

  try {
    const transactionResponse = await rootDb.transaction(async (db) => {
      if (mutationId) {
        await db.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${me.id}:${mutationId}`}, 0)
          )
        `)
        const receipt = await db.query.mutationReceipts.findFirst({
          where: and(
            eq(mutationReceipts.userId, me.id),
            eq(mutationReceipts.mutationId, mutationId),
          ),
        })
        if (receipt) {
          return Response.json(
            {
              ...(receipt.response as SyncMutationResponse),
              status: "alreadyApplied",
            } satisfies SyncMutationResponse,
            { headers: { "cache-control": "private, no-store" } },
          )
        }
      }
      const serverTime = new Date()
      const treeRoleCache = new Map<string, Promise<Role | null>>()
      const personRoleCache = new Map<string, Promise<Role | null>>()
      const roleForTree: RoleForTree = async (treeId) => {
        const cached = treeRoleCache.get(treeId)
        if (cached) return cached
        const role = await treeRole(db, me.id, treeId)
        treeRoleCache.set(treeId, Promise.resolve(role))
        return role
      }
      const roleForPerson = async (personId: string): Promise<Role | null> => {
        const cached = personRoleCache.get(personId)
        if (cached) return cached
        const role = await personRole(db, me.id, personId)
        personRoleCache.set(personId, Promise.resolve(role))
        return role
      }
      const activePersonCache = new Map<string, boolean>()
      const activePeopleExistForRequest: ActivePeopleExist = async (
        personIds,
      ) => {
        const uniqueIds = [...new Set(personIds)]
        if (uniqueIds.some((id) => !validId(id))) return false
        const unknownIds = uniqueIds.filter((id) => !activePersonCache.has(id))
        if (unknownIds.length > 0) {
          const rows = await db
            .select({ id: persons.id })
            .from(persons)
            .where(
              and(inArray(persons.id, unknownIds), isNull(persons.deletedAt)),
            )
          const activeIds = new Set(rows.map((row) => row.id))
          for (const id of unknownIds)
            activePersonCache.set(id, activeIds.has(id))
        }
        return uniqueIds.every((id) => activePersonCache.get(id) === true)
      }
      const referencedTreeIds = [
        ...new Set([
          ...body.trees.map((wire) => wire.id),
          ...body.treeMembers.map((wire) => wire.treeId),
          ...body.treeUnions.map((wire) => wire.treeId),
          ...body.treeParentChildRelationships.map((wire) => wire.treeId),
        ]),
      ]
      if (referencedTreeIds.length > 0) {
        const roleRows = await db
          .select({
            treeId: trees.id,
            ownerId: trees.ownerId,
            deletedAt: trees.deletedAt,
          })
          .from(trees)
          .where(inArray(trees.id, referencedTreeIds))
        for (const row of roleRows) {
          if (!row.deletedAt && row.ownerId === me.id) {
            treeRoleCache.set(row.treeId, Promise.resolve("owner"))
          }
        }
      }
      const referencedPersonIds = [
        ...new Set([
          ...body.persons.map((wire) => wire.id),
          ...body.treeMembers.map((wire) => wire.personId),
          ...body.unions.flatMap((wire) =>
            "deletedAt" in wire
              ? []
              : [wire.firstPersonId, wire.secondPersonId],
          ),
          ...body.parentChildRelationships.flatMap((wire) =>
            "deletedAt" in wire
              ? []
              : [wire.parentPersonId, wire.childPersonId],
          ),
        ]),
      ]
      const ownedPersonIds = new Set<string>()
      if (referencedPersonIds.length > 0) {
        const personRows = await db
          .select({
            id: persons.id,
            ownerId: persons.ownerId,
            deletedAt: persons.deletedAt,
          })
          .from(persons)
          .where(inArray(persons.id, referencedPersonIds))
        for (const row of personRows) {
          if (!row.deletedAt && row.ownerId === me.id) {
            ownedPersonIds.add(row.id)
            personRoleCache.set(row.id, Promise.resolve("owner"))
          }
        }
      }
      const ownedPersonDeleteIds = new Set(
        body.persons
          .filter((wire) => "deletedAt" in wire && ownedPersonIds.has(wire.id))
          .map((wire) => wire.id),
      )
      const cascadeUnionIds = new Set<string>()
      const cascadeParentIds = new Set<string>()
      if (ownedPersonDeleteIds.size > 0) {
        const ids = [...ownedPersonDeleteIds]
        const [affectedUnions, affectedParents] = await Promise.all([
          db
            .select({ id: unions.id })
            .from(unions)
            .where(
              or(
                inArray(unions.firstPersonId, ids),
                inArray(unions.secondPersonId, ids),
              ),
            ),
          db
            .select({ id: parentChildRelationships.id })
            .from(parentChildRelationships)
            .where(
              or(
                inArray(parentChildRelationships.parentPersonId, ids),
                inArray(parentChildRelationships.childPersonId, ids),
              ),
            ),
        ])
        for (const row of affectedUnions) cascadeUnionIds.add(row.id)
        for (const row of affectedParents) cascadeParentIds.add(row.id)
      }
      const applied = emptyAppliedIds()
      const skipped = emptyAppliedIds()
      const orphanCandidateRelationshipIds = new Set<string>()
      const cascadedReferences = emptyCascadedTreeReferences()

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
        if (cascadeUnionIds.has(wire.unionId)) {
          classify(applied, skipped, "treeUnions", key, true)
          continue
        }
        const updatedAt = wireTimestamp(wire)
        const revision = wireRevision(wire)
        if (
          !validId(wire.treeId)
          || !validId(wire.unionId)
          || !updatedAt
          || !revision
          || !canWrite(await roleForTree(wire.treeId))
        ) {
          classify(applied, skipped, "treeUnions", key, false)
          continue
        }
        const rows = await db
          .update(treeUnions)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeUnions.revision} + 1`,
          })
          .where(
            and(
              eq(treeUnions.treeId, wire.treeId),
              eq(treeUnions.unionId, wire.unionId),
              eq(treeUnions.revision, revision),
            ),
          )
          .returning({ treeId: treeUnions.treeId })
        classify(applied, skipped, "treeUnions", key, rows.length > 0)
      }
      for (const wire of body.treeParentChildRelationships) {
        if (!("deletedAt" in wire)) continue
        const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
        if (cascadeParentIds.has(wire.parentChildRelationshipId)) {
          classify(applied, skipped, "treeParentChildRelationships", key, true)
          continue
        }
        const updatedAt = wireTimestamp(wire)
        const revision = wireRevision(wire)
        if (
          !validId(wire.treeId)
          || !validId(wire.parentChildRelationshipId)
          || !updatedAt
          || !revision
          || !canWrite(await roleForTree(wire.treeId))
        ) {
          classify(applied, skipped, "treeParentChildRelationships", key, false)
          continue
        }
        const rows = await db
          .update(treeParentChildRelationships)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeParentChildRelationships.revision} + 1`,
          })
          .where(
            and(
              eq(treeParentChildRelationships.treeId, wire.treeId),
              eq(
                treeParentChildRelationships.parentChildRelationshipId,
                wire.parentChildRelationshipId,
              ),
              eq(treeParentChildRelationships.revision, revision),
            ),
          )
          .returning({ treeId: treeParentChildRelationships.treeId })
        if (rows.length > 0) {
          orphanCandidateRelationshipIds.add(wire.parentChildRelationshipId)
        }
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
        if (ownedPersonDeleteIds.has(wire.personId)) {
          classify(applied, skipped, "treeMembers", key, true)
          continue
        }
        const updatedAt = wireTimestamp(wire)
        const revision = wireRevision(wire)
        if (
          !validId(wire.treeId)
          || !validId(wire.personId)
          || !updatedAt
          || !revision
          || !canWrite(await roleForTree(wire.treeId))
        ) {
          classify(applied, skipped, "treeMembers", key, false)
          continue
        }
        const references = await tombstonePersonReferencesInTree(
          db,
          wire.treeId,
          wire.personId,
          serverTime,
        )
        for (const unionId of references.unionIds) {
          cascadedReferences.unionIds.add(unionId)
          cascadedReferences.treeUnionKeys.add(
            associationKey(wire.treeId, unionId),
          )
        }
        for (const relationshipId of references.parentRelationshipIds) {
          orphanCandidateRelationshipIds.add(relationshipId)
          cascadedReferences.parentRelationshipIds.add(relationshipId)
          cascadedReferences.treeParentRelationshipKeys.add(
            associationKey(wire.treeId, relationshipId),
          )
        }
        const rows = await db
          .update(treeMembers)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeMembers.revision} + 1`,
          })
          .where(
            and(
              eq(treeMembers.treeId, wire.treeId),
              eq(treeMembers.personId, wire.personId),
              eq(treeMembers.revision, revision),
            ),
          )
          .returning({ treeId: treeMembers.treeId })
        if (rows.length > 0) personRoleCache.delete(wire.personId)
        classify(applied, skipped, "treeMembers", key, rows.length > 0)
      }

      for (const wire of body.persons) {
        if (!("deletedAt" in wire)) continue
        const updatedAt = wireTimestamp(wire)
        const revision = wireRevision(wire)
        if (!updatedAt || !revision) {
          classify(applied, skipped, "persons", wire.id, false)
          continue
        }
        const wasDeleted = await tombstonePersonCascade(
          db,
          me.id,
          wire.id,
          revision,
          serverTime,
          photosToDeleteAfterCommit,
        )
        if (wasDeleted) personRoleCache.set(wire.id, Promise.resolve(null))
        classify(applied, skipped, "persons", wire.id, wasDeleted)
      }

      for (const wire of body.trees) {
        if (!("deletedAt" in wire)) continue
        const updatedAt = wireTimestamp(wire)
        const revision = wireRevision(wire)
        if (!updatedAt || !revision) {
          classify(applied, skipped, "trees", wire.id, false)
          continue
        }
        const rows = await db
          .update(trees)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${trees.revision} + 1`,
          })
          .where(
            and(
              eq(trees.id, wire.id),
              eq(trees.ownerId, me.id),
              eq(trees.revision, revision),
            ),
          )
          .returning({ id: trees.id })
        if (rows.length > 0) {
          await Promise.all([
            db
              .update(treeMembers)
              .set({
                deletedAt: serverTime,
                updatedAt: serverTime,
                revision: sql`${treeMembers.revision} + 1`,
              })
              .where(
                and(
                  eq(treeMembers.treeId, wire.id),
                  isNull(treeMembers.deletedAt),
                ),
              ),
            db
              .update(treeUnions)
              .set({
                deletedAt: serverTime,
                updatedAt: serverTime,
                revision: sql`${treeUnions.revision} + 1`,
              })
              .where(
                and(
                  eq(treeUnions.treeId, wire.id),
                  isNull(treeUnions.deletedAt),
                ),
              ),
            db
              .update(treeParentChildRelationships)
              .set({
                deletedAt: serverTime,
                updatedAt: serverTime,
                revision: sql`${treeParentChildRelationships.revision} + 1`,
              })
              .where(
                and(
                  eq(treeParentChildRelationships.treeId, wire.id),
                  isNull(treeParentChildRelationships.deletedAt),
                ),
              ),
            db.delete(treeShares).where(eq(treeShares.treeId, wire.id)),
          ])
          treeRoleCache.set(wire.id, Promise.resolve(null))
          personRoleCache.clear()
        }
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
              updatedAt: serverTime,
            })
            .onConflictDoNothing()
            .returning({ id: trees.id })
          if (rows.length > 0) {
            treeRoleCache.set(wire.id, Promise.resolve("owner"))
          }
          classify(applied, skipped, "trees", wire.id, rows.length > 0)
          continue
        }
        if (existing.ownerId !== me.id || existing.deletedAt) {
          classify(applied, skipped, "trees", wire.id, false)
          continue
        }
        const rows = await db
          .update(trees)
          .set({
            name: wire.name,
            updatedAt: serverTime,
            revision: sql`${trees.revision} + 1`,
          })
          .where(
            and(
              eq(trees.id, wire.id),
              eq(trees.ownerId, me.id),
              isNull(trees.deletedAt),
              eq(trees.revision, wire.revision ?? 0),
            ),
          )
          .returning({ id: trees.id })
        if (rows.length > 0) {
          treeRoleCache.set(wire.id, Promise.resolve("owner"))
        }
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
          || !isOptionalString(wire.birthplace)
          || !isOptionalPhoto(wire.photo)
          || !updatedAt
        ) {
          classify(applied, skipped, "persons", wire.id, false)
          continue
        }
        const existing = await db.query.persons.findFirst({
          where: eq(persons.id, wire.id),
        })
        if (!existing) {
          if (wire.photo && !isPhotoDataUrl(wire.photo)) {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          let photo: string | null
          try {
            photo = await normalizePhoto(me.id, wire.photo)
          } catch {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          const rows = await db
            .insert(persons)
            .values({
              id: wire.id,
              ownerId: me.id,
              name: wire.name,
              dob: wire.dob ?? null,
              dod: wire.dod ?? null,
              gender: wire.gender ?? null,
              birthplace: wire.birthplace ?? null,
              photo,
              updatedAt: serverTime,
            })
            .onConflictDoNothing()
            .returning({ id: persons.id })
          if (rows.length === 0 && photo) await deletePhoto(photo)
          if (rows.length > 0) {
            if (photo && !isPhotoDataUrl(photo)) uploadedPhotos.add(photo)
            personRoleCache.set(wire.id, Promise.resolve("owner"))
          }
          classify(applied, skipped, "persons", wire.id, rows.length > 0)
          continue
        }
        if (
          existing.deletedAt
          || existing.revision !== wire.revision
          || !canWrite(await roleForPerson(wire.id))
          || (wire.photo !== undefined
            && wire.photo !== null
            && !isPhotoDataUrl(wire.photo)
            && wire.photo !== existing.photo)
        ) {
          classify(applied, skipped, "persons", wire.id, false)
          continue
        }
        let photo: string | null
        try {
          photo = await normalizePhotoUpdate(
            existing.ownerId,
            existing.photo,
            wire.photo,
          )
        } catch {
          classify(applied, skipped, "persons", wire.id, false)
          continue
        }
        const result = await db.execute(
          sql<{ id: string; previousPhoto: string | null }>`
        WITH target_person AS MATERIALIZED (
          SELECT ${persons.id} AS id, ${persons.photo} AS photo
          FROM ${persons}
          WHERE ${persons.id} = ${wire.id}
            AND ${persons.deletedAt} IS NULL
            AND ${persons.revision} = ${wire.revision ?? 0}
          FOR UPDATE
        ),
        updated_person AS (
          UPDATE ${persons}
          SET "name" = ${wire.name},
              "dob" = ${wire.dob ?? null},
              "dod" = ${wire.dod ?? null},
              "gender" = ${wire.gender ?? null},
              "birthplace" = ${wire.birthplace ?? null},
              "photo" = ${photo},
              "updated_at" = ${serverTime},
              "revision" = "revision" + 1
          WHERE ${persons.id} IN (SELECT id FROM target_person)
          RETURNING ${persons.id} AS id
        )
        SELECT updated_person.id AS id,
               target_person.photo AS "previousPhoto"
        FROM updated_person
        INNER JOIN target_person ON target_person.id = updated_person.id
      `,
        )
        const updated = result.rows.length > 0
        if (!updated && photo && isPhotoDataUrl(wire.photo)) {
          await deletePhoto(photo)
        }
        const previousPhoto = result.rows[0]?.previousPhoto as
          | string
          | null
          | undefined
        if (
          previousPhoto
          && photo !== previousPhoto
          && !isPhotoDataUrl(previousPhoto)
        ) {
          photosToDeleteAfterCommit.add(previousPhoto)
        }
        if (
          updated
          && photo
          && photo !== previousPhoto
          && !isPhotoDataUrl(photo)
        ) {
          uploadedPhotos.add(photo)
        }
        classify(applied, skipped, "persons", wire.id, updated)
      }

      await activePeopleExistForRequest([
        ...body.treeMembers.flatMap((wire) =>
          "deletedAt" in wire ? [] : [wire.personId],
        ),
        ...body.unions.flatMap((wire) =>
          "deletedAt" in wire ? [] : [wire.firstPersonId, wire.secondPersonId],
        ),
        ...body.parentChildRelationships.flatMap((wire) =>
          "deletedAt" in wire ? [] : [wire.parentPersonId, wire.childPersonId],
        ),
      ])

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
          || !canWrite(await roleForTree(wire.treeId))
          || !(await activePeopleExistForRequest([wire.personId]))
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
          && !canWrite(await roleForPerson(wire.personId))
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
            updatedAt: serverTime,
          })
          .onConflictDoUpdate({
            target: [treeMembers.treeId, treeMembers.personId],
            set: {
              deletedAt: null,
              updatedAt: serverTime,
              revision: sql`${treeMembers.revision} + 1`,
            },
            setWhere: eq(treeMembers.revision, wire.revision ?? 0),
          })
          .returning({ treeId: treeMembers.treeId })
        if (rows.length > 0) personRoleCache.delete(wire.personId)
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
          || !(await activePeopleExistForRequest([
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
            !(await hasWritableTreeContaining(
              db,
              [wire.firstPersonId, wire.secondPersonId],
              roleForTree,
            ))
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
              updatedAt: serverTime,
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
          || !(await canWriteExistingUnion(db, me.id, existing, roleForTree))
        ) {
          classify(applied, skipped, "unions", wire.id, false)
          continue
        }
        const rows = await db
          .update(unions)
          .set({
            updatedAt: serverTime,
            revision: sql`${unions.revision} + 1`,
          })
          .where(
            and(
              eq(unions.id, wire.id),
              eq(unions.firstPersonId, wire.firstPersonId),
              eq(unions.secondPersonId, wire.secondPersonId),
              isNull(unions.deletedAt),
              eq(unions.revision, wire.revision ?? 0),
            ),
          )
          .returning({ id: unions.id })
        classify(applied, skipped, "unions", wire.id, rows.length > 0)
      }

      const createdParentRelationshipIds = new Set<string>()
      // Client-generated relationship ids that collided with a pre-existing active
      // canonical row for the same (parent, child) pair, mapped to that canonical
      // id so downstream association wires attach to the canonical relationship.
      const parentRelationshipIdAlias = new Map<
        string,
        {
          id: string
          revision: number
          type: ParentChildRelationshipType
        }
      >()
      // Canonical relationship ids adopted (not created) in this push. Treated like
      // created ids for association ACL gating, but excluded from orphan cleanup so
      // a pre-existing canonical row is never deleted as a side effect.
      const adoptedParentRelationshipIds = new Set<string>()
      const parentAssociationAliases = new Map<
        string,
        { parentChildRelationshipId: string; revision: number }
      >()
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
          || !(await activePeopleExistForRequest([
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
            !(await hasWritableTreeContaining(
              db,
              [wire.parentPersonId, wire.childPersonId],
              roleForTree,
            ))
          ) {
            classify(
              applied,
              skipped,
              "parentChildRelationships",
              wire.id,
              false,
            )
            continue
          }
          let inserted = false
          try {
            await db.transaction(async (tx) => {
              const rows = await tx
                .insert(parentChildRelationships)
                .values({
                  id: wire.id,
                  parentPersonId: wire.parentPersonId,
                  childPersonId: wire.childPersonId,
                  type: wire.type,
                  createdAt,
                  updatedAt: serverTime,
                })
                .onConflictDoNothing()
                .returning({ id: parentChildRelationships.id })
              inserted = rows.length > 0
            })
          } catch (error) {
            if (!isParentGraphConstraintError(error)) throw error
          }
          if (inserted) {
            createdParentRelationshipIds.add(wire.id)
          } else {
            // The insert was dropped by a conflict on the active (parent, child)
            // partial unique index: a canonical active row for this pair already
            // exists under a different id (typically an orphan left behind by a
            // prior remove-parent). Adopt that canonical row so the link can
            // attach and the orphan gets re-associated, rather than reporting the
            // wire as skipped (which would wipe the optimistic link).
            const canonical = await db.query.parentChildRelationships.findFirst(
              {
                where: and(
                  eq(
                    parentChildRelationships.parentPersonId,
                    wire.parentPersonId,
                  ),
                  eq(
                    parentChildRelationships.childPersonId,
                    wire.childPersonId,
                  ),
                  isNull(parentChildRelationships.deletedAt),
                ),
              },
            )
            if (canonical) {
              // A client that did not know this canonical row has no base
              // revision with which to change its global type. Re-associate the
              // existing fact and preserve its authoritative type.
              parentRelationshipIdAlias.set(wire.id, {
                id: canonical.id,
                revision: canonical.revision,
                type: canonical.type as ParentChildRelationshipType,
              })
              adoptedParentRelationshipIds.add(canonical.id)
              inserted = true
            }
          }
          classify(
            applied,
            skipped,
            "parentChildRelationships",
            wire.id,
            inserted,
          )
          continue
        }
        if (
          existing.deletedAt
          || existing.parentPersonId !== wire.parentPersonId
          || existing.childPersonId !== wire.childPersonId
          || !(await canWriteExistingParentRelationship(
            db,
            me.id,
            existing,
            roleForTree,
          ))
        ) {
          classify(applied, skipped, "parentChildRelationships", wire.id, false)
          continue
        }
        const rows = await db
          .update(parentChildRelationships)
          .set({
            type: wire.type,
            updatedAt: serverTime,
            revision: sql`${parentChildRelationships.revision} + 1`,
          })
          .where(
            and(
              eq(parentChildRelationships.id, wire.id),
              eq(parentChildRelationships.parentPersonId, wire.parentPersonId),
              eq(parentChildRelationships.childPersonId, wire.childPersonId),
              isNull(parentChildRelationships.deletedAt),
              eq(parentChildRelationships.revision, wire.revision ?? 0),
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
            && !(await canWriteExistingUnion(db, me.id, union, roleForTree))
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
              updatedAt: serverTime,
            })
            .onConflictDoNothing()
            .returning({ id: unionEvents.id })
          classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
          continue
        }
        if (
          existing.deletedAt
          || existing.unionId !== wire.unionId
          || !(await canWriteExistingUnion(db, me.id, union, roleForTree))
        ) {
          classify(applied, skipped, "unionEvents", wire.id, false)
          continue
        }
        const rows = await db
          .update(unionEvents)
          .set({
            type: wire.type,
            eventDate: wire.eventDate ?? null,
            updatedAt: serverTime,
            revision: sql`${unionEvents.revision} + 1`,
          })
          .where(
            and(
              eq(unionEvents.id, wire.id),
              eq(unionEvents.unionId, wire.unionId),
              isNull(unionEvents.deletedAt),
              eq(unionEvents.revision, wire.revision ?? 0),
            ),
          )
          .returning({ id: unionEvents.id })
        classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
      }

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
          || !canWrite(await roleForTree(wire.treeId))
        ) {
          classify(applied, skipped, "treeUnions", key, false)
          continue
        }
        const union = await db.query.unions.findFirst({
          where: and(eq(unions.id, wire.unionId), isNull(unions.deletedAt)),
        })
        if (
          !union
          || !(await activeTreeHasMembers(
            db,
            wire.treeId,
            [union.firstPersonId, union.secondPersonId],
            activePeopleExistForRequest,
          ))
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
          && !(await canWriteExistingUnion(db, me.id, union, roleForTree))
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
            updatedAt: serverTime,
          })
          .onConflictDoUpdate({
            target: [treeUnions.treeId, treeUnions.unionId],
            set: {
              deletedAt: null,
              updatedAt: serverTime,
              revision: sql`${treeUnions.revision} + 1`,
            },
            setWhere: eq(treeUnions.revision, wire.revision ?? 0),
          })
          .returning({ treeId: treeUnions.treeId })
        classify(applied, skipped, "treeUnions", key, rows.length > 0)
      }

      for (const wire of body.treeParentChildRelationships) {
        if ("deletedAt" in wire) continue
        // The client may have generated a fresh relationship id that collided with
        // a pre-existing canonical row; resolve to that canonical id so the
        // association attaches to the real relationship. The dirty key reported
        // back to the client still uses its original id.
        const relationshipId =
          parentRelationshipIdAlias.get(wire.parentChildRelationshipId)?.id
          ?? wire.parentChildRelationshipId
        const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
        const updatedAt = wireTimestamp(wire)
        const createdAt = wireCreatedAt(wire)
        if (
          !validId(wire.treeId)
          || !validId(wire.parentChildRelationshipId)
          || !updatedAt
          || !createdAt
          || !canWrite(await roleForTree(wire.treeId))
        ) {
          classify(applied, skipped, "treeParentChildRelationships", key, false)
          continue
        }
        const relationship = await db.query.parentChildRelationships.findFirst({
          where: and(
            eq(parentChildRelationships.id, relationshipId),
            isNull(parentChildRelationships.deletedAt),
          ),
        })
        if (
          !relationship
          || !(await activeTreeHasMembers(
            db,
            wire.treeId,
            [relationship.parentPersonId, relationship.childPersonId],
            activePeopleExistForRequest,
          ))
        ) {
          classify(applied, skipped, "treeParentChildRelationships", key, false)
          continue
        }
        const existing = await db.query.treeParentChildRelationships.findFirst({
          where: and(
            eq(treeParentChildRelationships.treeId, wire.treeId),
            eq(
              treeParentChildRelationships.parentChildRelationshipId,
              relationshipId,
            ),
          ),
        })
        if (
          !existing
          && !createdParentRelationshipIds.has(relationship.id)
          && !adoptedParentRelationshipIds.has(relationship.id)
          && !(await canWriteExistingParentRelationship(
            db,
            me.id,
            relationship,
            roleForTree,
          ))
        ) {
          classify(applied, skipped, "treeParentChildRelationships", key, false)
          continue
        }
        const rows = await db
          .insert(treeParentChildRelationships)
          .values({
            treeId: wire.treeId,
            parentChildRelationshipId: relationshipId,
            createdAt,
            updatedAt: serverTime,
          })
          .onConflictDoUpdate({
            target: [
              treeParentChildRelationships.treeId,
              treeParentChildRelationships.parentChildRelationshipId,
            ],
            set: {
              deletedAt: null,
              updatedAt: serverTime,
              revision: sql`${treeParentChildRelationships.revision} + 1`,
            },
            setWhere: eq(
              treeParentChildRelationships.revision,
              parentRelationshipIdAlias.has(wire.parentChildRelationshipId)
                ? (existing?.revision ?? 0)
                : (wire.revision ?? 0),
            ),
          })
          .returning({
            treeId: treeParentChildRelationships.treeId,
            revision: treeParentChildRelationships.revision,
          })
        if (
          rows[0]
          && parentRelationshipIdAlias.has(wire.parentChildRelationshipId)
        ) {
          parentAssociationAliases.set(key, {
            parentChildRelationshipId: relationshipId,
            revision: rows[0].revision,
          })
        }
        classify(
          applied,
          skipped,
          "treeParentChildRelationships",
          key,
          rows.length > 0,
        )
      }

      if (orphanCandidateRelationshipIds.size > 0) {
        const candidateIds = [...orphanCandidateRelationshipIds]
        const stillAssociatedRows = await db
          .select({
            id: treeParentChildRelationships.parentChildRelationshipId,
          })
          .from(treeParentChildRelationships)
          .where(
            and(
              inArray(
                treeParentChildRelationships.parentChildRelationshipId,
                candidateIds,
              ),
              isNull(treeParentChildRelationships.deletedAt),
            ),
          )
        const stillAssociated = new Set(
          stillAssociatedRows.map((row) => row.id),
        )
        const orphanIds = candidateIds.filter((id) => !stillAssociated.has(id))
        if (orphanIds.length > 0) {
          await db
            .update(parentChildRelationships)
            .set({
              deletedAt: serverTime,
              updatedAt: serverTime,
              revision: sql`${parentChildRelationships.revision} + 1`,
            })
            .where(
              and(
                inArray(parentChildRelationships.id, orphanIds),
                isNull(parentChildRelationships.deletedAt),
              ),
            )
        }
      }

      if (mutationId && !hasClassifiedRecords(skipped)) {
        const changesByTree = await collectMutationChanges(
          db,
          body,
          parentRelationshipIdAlias,
          cascadedReferences,
        )
        for (const [treeId, records] of [...changesByTree].sort(
          ([first], [second]) => first.localeCompare(second),
        )) {
          const versionRows = await db
            .update(trees)
            .set({ syncVersion: sql`${trees.syncVersion} + 1` })
            .where(eq(trees.id, treeId))
            .returning({ version: trees.syncVersion })
          const version = versionRows[0]?.version
          if (version === undefined) continue
          await db.insert(syncChanges).values({
            treeId,
            version,
            mutationId,
            records,
          })
        }
        const retentionCutoff = new Date(
          serverTime.getTime() - 30 * 24 * 60 * 60 * 1000,
        )
        await Promise.all([
          db
            .delete(syncChanges)
            .where(lt(syncChanges.createdAt, retentionCutoff)),
          db
            .delete(mutationReceipts)
            .where(lt(mutationReceipts.createdAt, retentionCutoff)),
        ])
      }
      const response: SyncPushResponse = {
        applied,
        skipped,
        ...(parentRelationshipIdAlias.size > 0
          ? {
              aliases: {
                parentChildRelationships: Object.fromEntries(
                  parentRelationshipIdAlias,
                ),
                ...(parentAssociationAliases.size > 0
                  ? {
                      treeParentChildRelationships: Object.fromEntries(
                        parentAssociationAliases,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        serverTime: serverTime.toISOString(),
      }
      if (mutationId && hasClassifiedRecords(skipped)) {
        const authoritativeRecords = await collectAuthoritativeConflictRecords(
          db,
          body,
        )
        conflictResponse = {
          applied: emptyAppliedIds(),
          skipped: requestIds(body),
          serverTime: response.serverTime,
          mutationId,
          status: "conflict",
          conflict: {
            retryable: true,
            reason: "revision-mismatch",
            records: authoritativeRecords,
          },
        }
        db.rollback()
      }
      const responseBody: SyncPushResponse | SyncMutationResponse = mutationId
        ? { ...response, mutationId, status: "applied" }
        : response
      if (mutationId) {
        await db.insert(mutationReceipts).values({
          userId: me.id,
          mutationId,
          response: responseBody,
        })
      }
      return Response.json(responseBody, {
        headers: { "cache-control": "private, no-store" },
      })
    })
    committedResponse = transactionResponse
    await Promise.all([...photosToDeleteAfterCommit].map(deletePhoto))
    return transactionResponse
  } catch (error) {
    if (committedResponse) {
      console.error("failed to delete replaced photos", error)
      return committedResponse
    }
    await Promise.all([...uploadedPhotos].map(deletePhoto))
    if (conflictResponse) {
      return Response.json(conflictResponse, {
        status: 409,
        headers: { "cache-control": "private, no-store" },
      })
    }
    throw error
  }
}
