import { and, eq, isNull, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import { isPhotoDataUrl } from "../blob"

/**
 * Tombstones every tree-scoped union and parent-child association that any of
 * the given (treeId, personId) removals participates in, in a fixed number of
 * queries instead of four per removal. Returns the (treeId, id) pairs it
 * tombstoned so the caller can fold them into the cascaded-reference sets.
 */
export async function tombstonePersonReferencesInTrees(
  db: DB,
  removals: ReadonlyArray<{ treeId: string; personId: string }>,
  serverTime: Date,
): Promise<{
  unionAssociations: { treeId: string; unionId: string }[]
  parentAssociations: { treeId: string; parentChildRelationshipId: string }[]
}> {
  if (removals.length === 0) {
    return { unionAssociations: [], parentAssociations: [] }
  }
  const unionAssociations = await db
    .select({ treeId: treeUnions.treeId, unionId: treeUnions.unionId })
    .from(treeUnions)
    .innerJoin(unions, eq(unions.id, treeUnions.unionId))
    .where(
      and(
        isNull(treeUnions.deletedAt),
        isNull(unions.deletedAt),
        or(
          ...removals.map((removal) =>
            and(
              eq(treeUnions.treeId, removal.treeId),
              or(
                eq(unions.firstPersonId, removal.personId),
                eq(unions.secondPersonId, removal.personId),
              ),
            ),
          ),
        ),
      ),
    )
  const parentAssociations = await db
    .select({
      treeId: treeParentChildRelationships.treeId,
      parentChildRelationshipId:
        treeParentChildRelationships.parentChildRelationshipId,
    })
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
        isNull(treeParentChildRelationships.deletedAt),
        isNull(parentChildRelationships.deletedAt),
        or(
          ...removals.map((removal) =>
            and(
              eq(treeParentChildRelationships.treeId, removal.treeId),
              or(
                eq(parentChildRelationships.parentPersonId, removal.personId),
                eq(parentChildRelationships.childPersonId, removal.personId),
              ),
            ),
          ),
        ),
      ),
    )

  await Promise.all([
    unionAssociations.length > 0
      ? db
          .update(treeUnions)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeUnions.revision} + 1`,
          })
          .where(
            and(
              isNull(treeUnions.deletedAt),
              sql`(tree_id, union_id) IN (${sql.join(
                unionAssociations.map(
                  (association) =>
                    sql`(${association.treeId}, ${association.unionId})`,
                ),
                sql`, `,
              )})`,
            ),
          )
      : Promise.resolve(),
    parentAssociations.length > 0
      ? db
          .update(treeParentChildRelationships)
          .set({
            deletedAt: serverTime,
            updatedAt: serverTime,
            revision: sql`${treeParentChildRelationships.revision} + 1`,
          })
          .where(
            and(
              isNull(treeParentChildRelationships.deletedAt),
              sql`(tree_id, parent_child_relationship_id) IN (${sql.join(
                parentAssociations.map(
                  (association) =>
                    sql`(${association.treeId}, ${association.parentChildRelationshipId})`,
                ),
                sql`, `,
              )})`,
            ),
          )
      : Promise.resolve(),
  ])

  return { unionAssociations, parentAssociations }
}

/** One PostgreSQL statement makes person-owner deletion globally atomic. */
export async function tombstonePersonCascade(
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
