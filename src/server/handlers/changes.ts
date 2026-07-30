import { and, asc, eq, gt, inArray, min, sql } from "drizzle-orm"
import { getDB } from "../../db"
import { syncChanges, trees } from "../../db/schema"
import type { SyncChangePage, SyncRecordSet } from "../../sync/types"
import { treeRole } from "../acl"
import { MAX_RESPONSE_PAGE_BYTES } from "../limits"
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

  const metadata = await db
    .select({
      version: syncChanges.version,
      mutationId: syncChanges.mutationId,
      bytes: sql<number>`octet_length(${syncChanges.records}::text)`,
    })
    .from(syncChanges)
    .where(
      and(eq(syncChanges.treeId, treeId), gt(syncChanges.version, version)),
    )
    .orderBy(asc(syncChanges.version))
    .limit(limit + 1)
  const treeVersion = treeRows[0]?.version ?? version
  if (
    version < treeVersion
    && (metadata.length === 0 || metadata[0]?.version !== version + 1)
  ) {
    return Response.json(
      { error: "reset required", resetRequired: true },
      { status: 410 },
    )
  }
  const selectedVersions: number[] = []
  let selectedBytes = 512
  for (const row of metadata.slice(0, limit)) {
    const rowBytes = Number(row.bytes) + row.mutationId.length + 256
    if (selectedBytes + rowBytes > MAX_RESPONSE_PAGE_BYTES) break
    selectedVersions.push(row.version)
    selectedBytes += rowBytes
  }
  if (metadata.length > 0 && selectedVersions.length === 0) {
    return Response.json(
      { error: "reset required", resetRequired: true },
      { status: 410 },
    )
  }
  const page =
    selectedVersions.length > 0
      ? await db
          .select()
          .from(syncChanges)
          .where(
            and(
              eq(syncChanges.treeId, treeId),
              inArray(syncChanges.version, selectedVersions),
            ),
          )
          .orderBy(asc(syncChanges.version))
      : []
  const hasMore = metadata.length > selectedVersions.length
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
