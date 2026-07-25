import { and, eq, isNull, or } from "drizzle-orm"
import type { DB } from "../db"
import { persons, treeMembers, treeShares, trees } from "../db/schema"

export type Role = "owner" | "editor" | "viewer"

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }
const FROM_RANK: Record<number, Role> = { 1: "viewer", 2: "editor", 3: "owner" }

export function resolveTreeRole(
  userId: string,
  tree: { ownerId: string; deletedAt: Date | null } | null,
  shareRoles: Role[],
): Role | null {
  if (!tree || tree.deletedAt) return null
  if (tree.ownerId === userId) return "owner"
  let bestRank = 0
  for (const role of shareRoles) bestRank = Math.max(bestRank, RANK[role] ?? 0)
  return bestRank > 0 ? (FROM_RANK[bestRank] ?? null) : null
}

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
  const shares = await db
    .select({ role: treeShares.role })
    .from(treeShares)
    .where(and(eq(treeShares.treeId, treeId), eq(treeShares.userId, userId)))
  return resolveTreeRole(
    userId,
    tree,
    shares.map((share) => share.role as Role),
  )
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
  if (!person.deletedAt && person.ownerId === userId) return "owner"

  // Trees containing this person that the user owns or is shared with.
  const rows = await db
    .select({ ownerId: trees.ownerId, shareRole: treeShares.role })
    .from(treeMembers)
    .innerJoin(
      trees,
      and(eq(trees.id, treeMembers.treeId), isNull(trees.deletedAt)),
    )
    .leftJoin(
      treeShares,
      and(eq(treeShares.treeId, trees.id), eq(treeShares.userId, userId)),
    )
    .where(
      and(
        eq(treeMembers.personId, personId),
        isNull(treeMembers.deletedAt),
        or(eq(trees.ownerId, userId), eq(treeShares.userId, userId)),
      ),
    )

  return resolvePersonRole(
    userId,
    { ownerId: person.ownerId, deletedAt: person.deletedAt },
    rows.map((row) => ({
      ownerId: row.ownerId,
      shareRole: row.shareRole as Role | null,
    })),
  )
}

export function canWrite(role: Role | null): boolean {
  return role === "owner" || role === "editor"
}

export function canRead(role: Role | null): boolean {
  return role !== null
}
