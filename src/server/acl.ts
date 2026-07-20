import { and, eq, isNull, sql } from "drizzle-orm"
import type { DB } from "../db"
import { persons, treeShares, trees, user } from "../db/schema.js"

export type Role = "owner" | "editor" | "viewer"

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }
const FROM_RANK: Record<number, Role> = { 1: "viewer", 2: "editor", 3: "owner" }

/** Highest role `userId` has on `treeId`, or null if none / tree deleted. */
export async function treeRole(
  db: DB,
  userId: string,
  treeId: string,
): Promise<Role | null> {
  const tree = await db.query.trees.findFirst({
    where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
  })
  if (!tree) return null
  if (tree.ownerId === userId) return "owner"
  const share = await db.query.treeShares.findFirst({
    where: and(eq(treeShares.treeId, treeId), eq(treeShares.userId, userId)),
  })
  return (share?.role as Role | null) ?? null
}

/**
 * Pure role resolution for a person — extracted from `personRole` so it can be
 * unit-tested without a database. Given the person row and the trees that
 * contain the person AND that the user can access (owned or shared), returns
 * the highest role the user has.
 */
export function resolvePersonRole(
  userId: string,
  person: { ownerId: string; deletedAt: Date | null } | null,
  accessibleTrees: Array<{ ownerId: string; shareRole: Role | null }>,
): Role | null {
  if (!person || person.deletedAt) return null
  if (person.ownerId === userId) return "owner"
  let bestRank = 0
  for (const t of accessibleTrees) {
    const role: Role | null = t.ownerId === userId ? "owner" : t.shareRole
    if (!role) continue
    const rank = RANK[role]
    if (rank !== undefined && rank > bestRank) bestRank = rank
  }
  return bestRank > 0 ? (FROM_RANK[bestRank] ?? null) : null
}

/**
 * Highest role `userId` has on person `personId`. Owners of the person row,
 * owners of any tree the person is a member of, editors, and viewers are
 * considered in descending priority.
 */
export async function personRole(
  db: DB,
  userId: string,
  personId: string,
): Promise<Role | null> {
  const person = await db.query.persons.findFirst({
    where: eq(persons.id, personId),
  })
  if (!person) return null

  // Trees containing this person that the user owns or is shared with.
  const accessible = await db.execute(
    sql`
      SELECT t.owner_id AS owner_id, ts.role AS share_role
      FROM trees t
      LEFT JOIN tree_shares ts
        ON ts.tree_id = t.id AND ts.user_id = ${userId}
      WHERE t.deleted_at IS NULL
        AND t.edges -> 'members' ? ${personId}
        AND (t.owner_id = ${userId} OR ts.user_id = ${userId})
    `,
  )

  const rows = accessible.rows as Array<{
    owner_id: string
    share_role: Role | null
  }>
  return resolvePersonRole(
    userId,
    { ownerId: person.ownerId, deletedAt: person.deletedAt },
    rows.map((r) => ({ ownerId: r.owner_id, shareRole: r.share_role })),
  )
}

export function canWrite(role: Role | null): boolean {
  return role === "owner" || role === "editor"
}

export function canRead(role: Role | null): boolean {
  return role !== null
}

/** Email of `userId`, or null. Used to label shared-with-me trees. */
export async function userEmail(
  db: DB,
  userId: string,
): Promise<string | null> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) })
  return u?.email ?? null
}
