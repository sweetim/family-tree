import { sql } from "drizzle-orm"
import type { DB } from "../../db"
import { MAX_TREE_MEMBERS, MAX_TREE_RELATED_RECORDS } from "../limits"
import type { TreeUsage } from "./push-state"

export type QuotaViolation = {
  treeId: string
  reason: "tree-member-limit" | "tree-related-record-limit"
  maximum: number
  current: number
}

export async function loadTreeUsage(
  db: DB,
  treeIds: string[],
): Promise<Map<string, TreeUsage>> {
  if (treeIds.length === 0) return new Map()
  const values = sql.join(
    treeIds.map((treeId) => sql`${treeId}`),
    sql`, `,
  )
  const result = await db.execute<{
    treeId: string
    members: string | number
    relatedRecords: string | number
  }>(sql`
    SELECT scope.tree_id AS "treeId",
      (
        SELECT count(*)
        FROM tree_members AS membership
        WHERE membership.tree_id = scope.tree_id
          AND membership.deleted_at IS NULL
      ) AS members,
      (
        2 * (
          SELECT count(*)
          FROM tree_unions AS association
          INNER JOIN unions AS relationship
            ON relationship.id = association.union_id
            AND relationship.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
        + (
          SELECT count(*)
          FROM tree_unions AS association
          INNER JOIN unions AS relationship
            ON relationship.id = association.union_id
            AND relationship.deleted_at IS NULL
          INNER JOIN union_events AS event
            ON event.union_id = relationship.id
            AND event.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
        + 2 * (
          SELECT count(*)
          FROM tree_parent_child_relationships AS association
          INNER JOIN parent_child_relationships AS relationship
            ON relationship.id = association.parent_child_relationship_id
            AND relationship.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
      ) AS "relatedRecords"
    FROM unnest(ARRAY[${values}]::text[]) AS scope(tree_id)
  `)
  return new Map(
    result.rows.map((row) => [
      row.treeId,
      {
        members: Number(row.members),
        relatedRecords: Number(row.relatedRecords),
      },
    ]),
  )
}

export function enforceQuota(
  usageBefore: Map<string, TreeUsage>,
  usageAfter: Map<string, TreeUsage>,
  quotaTreeIds: string[],
): QuotaViolation | undefined {
  for (const treeId of quotaTreeIds) {
    const before = usageBefore.get(treeId) ?? {
      members: 0,
      relatedRecords: 0,
    }
    const after = usageAfter.get(treeId) ?? before
    if (after.members > MAX_TREE_MEMBERS && after.members > before.members) {
      return {
        treeId,
        reason: "tree-member-limit",
        maximum: MAX_TREE_MEMBERS,
        current: after.members,
      }
    }
    if (
      after.relatedRecords > MAX_TREE_RELATED_RECORDS
      && after.relatedRecords > before.relatedRecords
    ) {
      return {
        treeId,
        reason: "tree-related-record-limit",
        maximum: MAX_TREE_RELATED_RECORDS,
        current: after.relatedRecords,
      }
    }
  }
  return undefined
}
