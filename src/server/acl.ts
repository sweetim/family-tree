import { and, eq, isNull, or } from "drizzle-orm"
import type { DB } from "../db"
import { getDB } from "../db/index"
import { persons, treeMembers, treeShares, trees } from "../db/schema"
import { requireSession, type SessionUser } from "./session"
import { isValidSyncId } from "./sync-validation"

export type Role = "owner" | "editor" | "viewer"

export type OwnerGuardError = { status: 400 | 401 | 403; error: string }
export type OwnerGuardOk = { me: SessionUser; db: DB }
export type OwnerGuardResult = OwnerGuardError | OwnerGuardOk

/**
 * Resolve the session and verify the caller owns `treeId`. Shared by the
 * owner-only share and access-request handlers. Returns an error object
 * (with `error`/`status`) on failure, or `{ me, db }` on success.
 */
export async function requireOwner(
  request: Request,
  treeId: string,
): Promise<OwnerGuardResult> {
  if (!isValidSyncId(treeId)) {
    return { status: 400, error: "invalid tree id" }
  }
  const me = await requireSession(request)
  if (!me) return { status: 401, error: "unauthorized" }
  const db = getDB()
  const role = await treeRole(db, me.id, treeId)
  if (role !== "owner") return { status: 403, error: "forbidden" }
  return { me, db }
}

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
 * considered in descending priority. Pass `person` when the caller already
 * loaded the row to avoid re-fetching it (e.g. the photo proxy).
 */
export async function personRole(
  db: DB,
  userId: string,
  personId: string,
  person?: typeof persons.$inferSelect,
): Promise<Role | null> {
  const row =
    person
    ?? (await db.query.persons.findFirst({ where: eq(persons.id, personId) }))
  if (!row) return null
  if (!row.deletedAt && row.ownerId === userId) return "owner"

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
    { ownerId: row.ownerId, deletedAt: row.deletedAt },
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
