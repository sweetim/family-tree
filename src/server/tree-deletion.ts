import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { DB } from "../db"
import {
  parentChildRelationships,
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
} from "../db/schema"

// This must match the parent-graph trigger in the normalized-data migration.
const PARENT_GRAPH_INTEGRITY_LOCK = "7091885217057541735"

export type TreeDeletionEffects = {
  parentRelationshipIds: string[]
}

/** Locks used by the direct deletion endpoint before its transactional cascade. */
export async function lockTreeDeletion(db: DB, treeId: string): Promise<void> {
  await db.execute(sql`
    SELECT
      pg_advisory_xact_lock(${sql.raw(PARENT_GRAPH_INTEGRITY_LOCK)}),
      pg_advisory_xact_lock(hashtextextended(${`sync-tree:${treeId}`}, 0))
  `)
}

/**
 * Tombstones one active, owner-controlled tree and its tree-local records.
 * Callers must already hold the parent-graph and tree advisory locks and run
 * this inside their surrounding transaction.
 */
export async function tombstoneOwnedTree(
  db: DB,
  {
    ownerId,
    treeId,
    expectedRevision,
    serverTime,
  }: {
    ownerId: string
    treeId: string
    expectedRevision?: number
    serverTime: Date
  },
): Promise<TreeDeletionEffects | null> {
  const predicates = [
    eq(trees.id, treeId),
    eq(trees.ownerId, ownerId),
    isNull(trees.deletedAt),
  ]
  if (expectedRevision !== undefined) {
    predicates.push(eq(trees.revision, expectedRevision))
  }
  const deletedTrees = await db
    .update(trees)
    .set({
      deletedAt: serverTime,
      updatedAt: serverTime,
      revision: sql`${trees.revision} + 1`,
    })
    .where(and(...predicates))
    .returning({ id: trees.id })
  if (deletedTrees.length === 0) return null

  const parentRelationships = await db
    .select({ id: treeParentChildRelationships.parentChildRelationshipId })
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(treeParentChildRelationships.treeId, treeId),
        isNull(treeParentChildRelationships.deletedAt),
      ),
    )

  await Promise.all([
    db
      .update(treeMembers)
      .set({
        deletedAt: serverTime,
        updatedAt: serverTime,
        revision: sql`${treeMembers.revision} + 1`,
      })
      .where(
        and(eq(treeMembers.treeId, treeId), isNull(treeMembers.deletedAt)),
      ),
    db
      .update(treeUnions)
      .set({
        deletedAt: serverTime,
        updatedAt: serverTime,
        revision: sql`${treeUnions.revision} + 1`,
      })
      .where(and(eq(treeUnions.treeId, treeId), isNull(treeUnions.deletedAt))),
    db
      .update(treeParentChildRelationships)
      .set({
        deletedAt: serverTime,
        updatedAt: serverTime,
        revision: sql`${treeParentChildRelationships.revision} + 1`,
      })
      .where(
        and(
          eq(treeParentChildRelationships.treeId, treeId),
          isNull(treeParentChildRelationships.deletedAt),
        ),
      ),
    db.delete(treeShares).where(eq(treeShares.treeId, treeId)),
  ])

  return { parentRelationshipIds: parentRelationships.map((row) => row.id) }
}

/** Tombstones global parent facts that no active tree association still uses. */
export async function tombstoneOrphanParentRelationships(
  db: DB,
  parentRelationshipIds: Iterable<string>,
  serverTime: Date,
): Promise<void> {
  const candidateIds = [...new Set(parentRelationshipIds)]
  if (candidateIds.length === 0) return
  const stillAssociatedRows = await db
    .select({ id: treeParentChildRelationships.parentChildRelationshipId })
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
  const stillAssociated = new Set(stillAssociatedRows.map((row) => row.id))
  const orphanIds = candidateIds.filter((id) => !stillAssociated.has(id))
  if (orphanIds.length === 0) return
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
