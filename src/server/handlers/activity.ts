import { desc, eq, inArray } from "drizzle-orm"
import { getDB } from "../../db"
import { mutationReceipts, syncChanges, user } from "../../db/schema"
import type { SyncRecordSet, TreeActivityResponse } from "../../sync/types"
import { treeRole } from "../acl"
import { requireSession } from "../session"
import { isValidSyncId } from "../sync-validation"

const DEFAULT_LIMIT = 30
const MAXIMUM_LIMIT = 100

/**
 * Newest-first recent-activity feed for a tree. Reads the same `sync_changes`
 * rows the sync pipeline writes (see `collectMutationChanges` in
 * `sync/push.ts`) but skips its cursor / "reset required" contract, which is
 * meant for continuous delta sync and rejects a fresh read once the 30-day
 * retention window has purged early versions. Any viewer or editor of the tree
 * may read its activity.
 */
export async function getTreeActivity(
  request: Request,
  treeId: string,
): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }

  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAXIMUM_LIMIT)
    : DEFAULT_LIMIT

  const db = getDB()
  if (!(await treeRole(db, me.id, treeId))) {
    return Response.json({ error: "tree not found" }, { status: 404 })
  }

  const rows = await db
    .select({
      version: syncChanges.version,
      mutationId: syncChanges.mutationId,
      createdAt: syncChanges.createdAt,
      records: syncChanges.records,
    })
    .from(syncChanges)
    .where(eq(syncChanges.treeId, treeId))
    .orderBy(desc(syncChanges.version))
    .limit(limit)

  // Resolve each change's author from the mutation receipt that recorded who
  // pushed it. A change's mutationId maps to exactly one (userId, mutationId)
  // receipt; first row wins on the unlikely collision of two users sharing an
  // id. Receipts share the change log's 30-day retention, so older changes
  // have no author — surfaced as null rather than hidden.
  const authorByMutation = new Map<string, { userId: string; name: string }>()
  const mutationIds = [...new Set(rows.map((row) => row.mutationId))]
  if (mutationIds.length > 0) {
    const authorRows = await db
      .select({
        mutationId: mutationReceipts.mutationId,
        userId: mutationReceipts.userId,
        name: user.name,
        email: user.email,
      })
      .from(mutationReceipts)
      .innerJoin(user, eq(mutationReceipts.userId, user.id))
      .where(inArray(mutationReceipts.mutationId, mutationIds))
    for (const row of authorRows) {
      if (!authorByMutation.has(row.mutationId)) {
        authorByMutation.set(row.mutationId, {
          userId: row.userId,
          name: row.name || row.email,
        })
      }
    }
  }

  const body: TreeActivityResponse = {
    treeId,
    changes: rows.map((row) => {
      const author = authorByMutation.get(row.mutationId)
      return {
        version: row.version,
        mutationId: row.mutationId,
        createdAt: row.createdAt.toISOString(),
        records: row.records as SyncRecordSet,
        author: author
          ? { name: author.userId === me.id ? "You" : author.name }
          : null,
      }
    }),
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
