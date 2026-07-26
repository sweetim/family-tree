import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { getDB } from "../../db/index"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type { SyncAppliedIds, SyncPushResponse } from "../../sync/types"
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

type SyncCollection = keyof SyncAppliedIds
type RoleForTree = (treeId: string) => Promise<Role | null>
type ActivePeopleExist = (personIds: string[]) => Promise<boolean>

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
  const roles: Array<Role | null> = []
  for (const treeId of new Set(treeIds)) {
    roles.push(await roleForTree(treeId))
  }
  return roles
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
  const result = await db.execute(sql<{ id: string; photo: string | null }>`
    WITH     server_clock AS MATERIALIZED (
      SELECT ${clientUpdatedAt}::timestamptz AS value
    ),
    target_person AS MATERIALIZED (
      UPDATE ${persons}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock)
      WHERE ${persons.id} = ${personId}
        AND ${persons.ownerId} = ${userId}
        AND ${persons.deletedAt} IS NULL
        AND ${persons.updatedAt} < ${clientUpdatedAt}
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
    )
    SELECT id, photo FROM target_person
  `)
  const previousPhoto = result.rows[0]?.photo as string | null | undefined
  if (previousPhoto && !isPhotoDataUrl(previousPhoto)) {
    await deletePhoto(previousPhoto)
  }
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
  const db = getDB()
  const treeRoleCache = new Map<string, Promise<Role | null>>()
  const personRoleCache = new Map<string, Promise<Role | null>>()
  const roleForTree: RoleForTree = async (treeId) => {
    const cached = treeRoleCache.get(treeId)
    if (cached) return cached
    const role = await treeRole(db, me.id, treeId)
    if (role === "owner") treeRoleCache.set(treeId, Promise.resolve(role))
    return role
  }
  const roleForPerson = async (personId: string): Promise<Role | null> => {
    const cached = personRoleCache.get(personId)
    if (cached) return cached
    const role = await personRole(db, me.id, personId)
    if (role === "owner") personRoleCache.set(personId, Promise.resolve(role))
    return role
  }
  const activePersonCache = new Map<string, boolean>()
  const activePeopleExistForRequest: ActivePeopleExist = async (personIds) => {
    const uniqueIds = [...new Set(personIds)]
    if (uniqueIds.some((id) => !validId(id))) return false
    const unknownIds = uniqueIds.filter((id) => !activePersonCache.has(id))
    if (unknownIds.length > 0) {
      const rows = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(inArray(persons.id, unknownIds), isNull(persons.deletedAt)))
      const activeIds = new Set(rows.map((row) => row.id))
      for (const id of unknownIds) activePersonCache.set(id, activeIds.has(id))
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
        "deletedAt" in wire ? [] : [wire.firstPersonId, wire.secondPersonId],
      ),
      ...body.parentChildRelationships.flatMap((wire) =>
        "deletedAt" in wire ? [] : [wire.parentPersonId, wire.childPersonId],
      ),
    ]),
  ]
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
        personRoleCache.set(row.id, Promise.resolve("owner"))
      }
    }
  }
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
      || !canWrite(await roleForTree(wire.treeId))
    ) {
      classify(applied, skipped, "treeUnions", key, false)
      continue
    }
    const rows = await db
      .update(treeUnions)
      .set({ deletedAt: updatedAt, updatedAt: updatedAt })
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
      || !canWrite(await roleForTree(wire.treeId))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const rows = await db
      .update(treeParentChildRelationships)
      .set({ deletedAt: updatedAt, updatedAt: updatedAt })
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
      || !canWrite(await roleForTree(wire.treeId))
      || (await personIsReferencedInTree(db, wire.treeId, wire.personId))
    ) {
      classify(applied, skipped, "treeMembers", key, false)
      continue
    }
    const rows = await db
      .update(treeMembers)
      .set({ deletedAt: updatedAt, updatedAt: updatedAt })
      .where(
        and(
          eq(treeMembers.treeId, wire.treeId),
          eq(treeMembers.personId, wire.personId),
          lt(treeMembers.updatedAt, updatedAt),
        ),
      )
      .returning({ treeId: treeMembers.treeId })
    if (rows.length > 0) personRoleCache.delete(wire.personId)
    classify(applied, skipped, "treeMembers", key, rows.length > 0)
  }

  for (const wire of body.persons) {
    if (!("deletedAt" in wire)) continue
    const updatedAt = wireTimestamp(wire)
    if (!updatedAt) {
      classify(applied, skipped, "persons", wire.id, false)
      continue
    }
    const wasDeleted = await tombstonePersonCascade(
      db,
      me.id,
      wire.id,
      updatedAt,
    )
    if (wasDeleted) personRoleCache.set(wire.id, Promise.resolve(null))
    classify(applied, skipped, "persons", wire.id, wasDeleted)
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
      .set({ deletedAt: updatedAt, updatedAt: updatedAt })
      .where(
        and(
          eq(trees.id, wire.id),
          eq(trees.ownerId, me.id),
          lt(trees.updatedAt, updatedAt),
        ),
      )
      .returning({ id: trees.id })
    if (rows.length > 0) {
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
          updatedAt: updatedAt,
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
      .set({ name: wire.name, updatedAt: updatedAt })
      .where(
        and(
          eq(trees.id, wire.id),
          eq(trees.ownerId, me.id),
          isNull(trees.deletedAt),
          lt(trees.updatedAt, updatedAt),
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
      || !isOptionalString(wire.location)
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
          location: wire.location ?? null,
          photo,
          updatedAt: updatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: persons.id })
      if (rows.length === 0 && photo) await deletePhoto(photo)
      if (rows.length > 0) {
        personRoleCache.set(wire.id, Promise.resolve("owner"))
      }
      classify(applied, skipped, "persons", wire.id, rows.length > 0)
      continue
    }
    if (
      existing.deletedAt
      || existing.updatedAt >= updatedAt
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
            AND ${persons.updatedAt} < ${updatedAt}
          FOR UPDATE
        ),
        updated_person AS (
          UPDATE ${persons}
          SET "name" = ${wire.name},
              "dob" = ${wire.dob ?? null},
              "dod" = ${wire.dod ?? null},
              "gender" = ${wire.gender ?? null},
              "location" = ${wire.location ?? null},
              "photo" = ${photo},
              "updated_at" = ${updatedAt}
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
      await deletePhoto(previousPhoto)
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
        updatedAt: updatedAt,
      })
      .onConflictDoUpdate({
        target: [treeMembers.treeId, treeMembers.personId],
        set: { deletedAt: null, updatedAt: updatedAt },
        setWhere: lt(treeMembers.updatedAt, updatedAt),
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
          updatedAt: updatedAt,
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
      .set({ updatedAt: updatedAt })
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
        classify(applied, skipped, "parentChildRelationships", wire.id, false)
        continue
      }
      let inserted = false
      try {
        const rows = await db
          .insert(parentChildRelationships)
          .values({
            id: wire.id,
            parentPersonId: wire.parentPersonId,
            childPersonId: wire.childPersonId,
            type: wire.type,
            createdAt,
            updatedAt: updatedAt,
          })
          .onConflictDoNothing()
          .returning({ id: parentChildRelationships.id })
        inserted = rows.length > 0
      } catch (error) {
        if (!isParentGraphConstraintError(error)) throw error
      }
      if (inserted) createdParentRelationshipIds.add(wire.id)
      classify(applied, skipped, "parentChildRelationships", wire.id, inserted)
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
      .set({ type: wire.type, updatedAt: updatedAt })
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
          updatedAt: updatedAt,
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
        updatedAt: updatedAt,
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
        updatedAt: updatedAt,
      })
      .onConflictDoUpdate({
        target: [treeUnions.treeId, treeUnions.unionId],
        set: { deletedAt: null, updatedAt: updatedAt },
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
      || !canWrite(await roleForTree(wire.treeId))
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
          wire.parentChildRelationshipId,
        ),
      ),
    })
    if (
      !existing
      && !createdParentRelationshipIds.has(relationship.id)
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
        parentChildRelationshipId: wire.parentChildRelationshipId,
        createdAt,
        updatedAt: updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          treeParentChildRelationships.treeId,
          treeParentChildRelationships.parentChildRelationshipId,
        ],
        set: { deletedAt: null, updatedAt: updatedAt },
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
  return Response.json(response, {
    headers: { "cache-control": "private, no-store" },
  })
}
