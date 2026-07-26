import { sql } from "drizzle-orm"
import { getDB } from "../../db/index"
import {
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
} from "../../db/schema"
import { requireSession } from "../session"
import { isValidSyncId } from "../sync-validation"

/** DELETE /api/trees/:treeId - owner-only, atomic tree deletion. */
export async function deleteTree(
  request: Request,
  treeId: string,
): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }

  const db = getDB()
  const result = await db.execute(sql<{ id: string }>`
    WITH server_clock AS MATERIALIZED (
      SELECT CURRENT_TIMESTAMP AS value
    ),
    target_tree AS MATERIALIZED (
      UPDATE ${trees}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${trees.id} = ${treeId}
        AND ${trees.ownerId} = ${me.id}
        AND ${trees.deletedAt} IS NULL
      RETURNING ${trees.id} AS id
    ),
    tombstoned_memberships AS (
      UPDATE ${treeMembers}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeMembers.treeId} IN (SELECT id FROM target_tree)
        AND ${treeMembers.deletedAt} IS NULL
      RETURNING ${treeMembers.treeId}
    ),
    tombstoned_tree_unions AS (
      UPDATE ${treeUnions}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeUnions.treeId} IN (SELECT id FROM target_tree)
        AND ${treeUnions.deletedAt} IS NULL
      RETURNING ${treeUnions.treeId}
    ),
    tombstoned_tree_parent_relationships AS (
      UPDATE ${treeParentChildRelationships}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${treeParentChildRelationships.treeId} IN (
        SELECT id FROM target_tree
      )
        AND ${treeParentChildRelationships.deletedAt} IS NULL
      RETURNING ${treeParentChildRelationships.treeId}
    ),
    removed_shares AS (
      DELETE FROM ${treeShares}
      WHERE ${treeShares.treeId} IN (SELECT id FROM target_tree)
      RETURNING ${treeShares.treeId}
    )
    SELECT id FROM target_tree
  `)

  if (result.rows.length === 0) {
    return Response.json({ error: "tree not found" }, { status: 404 })
  }
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}
