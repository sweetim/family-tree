import { and, asc, eq, gt, min } from "drizzle-orm"
import { getDB } from "../../db"
import { syncChanges, trees } from "../../db/schema"
import type { SyncChangePage, SyncRecordSet } from "../../sync/types"
import { treeRole } from "../acl"
import { requireSession } from "../session"
import { decodeSyncCursor, encodeSyncCursor } from "../sync/cursor"
import { isValidSyncId } from "../sync-validation"

const DEFAULT_LIMIT = 50
const MAXIMUM_LIMIT = 100

export async function getChanges(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const treeId = url.searchParams.get("treeId")
  const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(requestedLimit, MAXIMUM_LIMIT)
    : 0
  if (!isValidSyncId(treeId) || limit < 1) {
    return Response.json({ error: "invalid changes query" }, { status: 400 })
  }
  const cursor = decodeSyncCursor(url.searchParams.get("cursor"), treeId)
  if (cursor === undefined) {
    return Response.json({ error: "invalid cursor" }, { status: 400 })
  }

  const db = getDB()
  if (!(await treeRole(db, me.id, treeId))) {
    return Response.json({ error: "tree not found" }, { status: 404 })
  }
  const version = cursor?.version ?? 0
  const [minimumRows, treeRows] = await Promise.all([
    db
      .select({ version: min(syncChanges.version) })
      .from(syncChanges)
      .where(eq(syncChanges.treeId, treeId)),
    db
      .select({ version: trees.syncVersion })
      .from(trees)
      .where(eq(trees.id, treeId))
      .limit(1),
  ])
  const minimumVersion = minimumRows[0]?.version
  if (
    minimumVersion !== null
    && minimumVersion !== undefined
    && version < minimumVersion - 1
  ) {
    return Response.json(
      { error: "reset required", resetRequired: true },
      { status: 410 },
    )
  }

  const rows = await db
    .select()
    .from(syncChanges)
    .where(
      and(eq(syncChanges.treeId, treeId), gt(syncChanges.version, version)),
    )
    .orderBy(asc(syncChanges.version))
    .limit(limit + 1)
  const treeVersion = treeRows[0]?.version ?? version
  if (
    version < treeVersion
    && (rows.length === 0 || rows[0]?.version !== version + 1)
  ) {
    return Response.json(
      { error: "reset required", resetRequired: true },
      { status: 410 },
    )
  }
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const currentVersion = page.at(-1)?.version ?? treeVersion
  const body: SyncChangePage = {
    treeId,
    changes: page.map((row) => ({
      version: row.version,
      mutationId: row.mutationId,
      records: row.records as SyncRecordSet,
    })),
    cursor: encodeSyncCursor({ treeId, version: currentVersion }),
    hasMore,
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
