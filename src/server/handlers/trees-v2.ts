import { and, eq, isNull, sql } from "drizzle-orm"
import { getDB } from "../../db"
import { treeShares, trees, user } from "../../db/schema"
import type {
  TreeManifestItem,
  TreeManifestResponse,
  TreeRecordWire,
  TreeSnapshotResponse,
} from "../../sync/types"
import { treeRole } from "../acl"
import { requireSession } from "../session"
import { encodeSyncCursor } from "../sync/cursor"
import {
  loadActiveRecordsByTree,
  loadActiveRecordsForPeople,
} from "../sync/pull"
import { treeToWire } from "../sync/wire"
import { isValidSyncId } from "../sync-validation"

const DEFAULT_PAGE_SIZE = 50
const MAXIMUM_PAGE_SIZE = 100

type ManifestCursor = { createdAt: string; id: string }

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_PAGE_SIZE
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAXIMUM_PAGE_SIZE)
    : null
}

function encodeCursor(cursor: ManifestCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function decodeCursor(value: string | null): ManifestCursor | null | undefined {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown
    if (!parsed || typeof parsed !== "object") return undefined
    const cursor = parsed as Record<string, unknown>
    if (
      typeof cursor.createdAt !== "string"
      || !Number.isFinite(new Date(cursor.createdAt).getTime())
      || !isValidSyncId(cursor.id)
    ) {
      return undefined
    }
    return { createdAt: cursor.createdAt, id: cursor.id }
  } catch {
    return undefined
  }
}

type ManifestRow = {
  id: string
  ownerId: string
  ownerEmail: string | null
  name: string
  revision: number
  syncVersion: string | number
  createdAt: Date | string
  updatedAt: Date | string
  role: "owner" | "editor" | "viewer"
  memberCount: string | number
}

/** Paginated metadata only; no family graph rows are loaded. */
export async function listTrees(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const limit = parseLimit(url.searchParams.get("limit"))
  const cursor = decodeCursor(url.searchParams.get("cursor"))
  if (!limit || cursor === undefined) {
    return Response.json({ error: "invalid pagination" }, { status: 400 })
  }

  const db = getDB()
  await db
    .update(treeShares)
    .set({ userId: me.id })
    .where(
      and(
        eq(treeShares.email, me.email.toLowerCase()),
        isNull(treeShares.userId),
      ),
    )
  const result = await db.execute(sql<ManifestRow>`
    SELECT
      t.id,
      t.owner_id AS "ownerId",
      owner.email AS "ownerEmail",
      t.name,
      t.revision,
      t.sync_version AS "syncVersion",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      CASE
        WHEN t.owner_id = ${me.id} THEN 'owner'
        ELSE s.role::text
      END AS role,
      count(m.person_id)::int AS "memberCount"
    FROM trees t
    INNER JOIN "user" owner ON owner.id = t.owner_id
    LEFT JOIN LATERAL (
      SELECT share.role, share.user_id
      FROM tree_shares share
      WHERE share.tree_id = t.id
        AND share.user_id = ${me.id}
      ORDER BY CASE share.role WHEN 'editor' THEN 2 ELSE 1 END DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN tree_members m
      ON m.tree_id = t.id
      AND m.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
      AND (t.owner_id = ${me.id} OR s.user_id = ${me.id})
      AND (
        ${cursor?.createdAt ?? null}::timestamptz IS NULL
        OR (t.created_at, t.id) > (
          ${cursor?.createdAt ?? null}::timestamptz,
          ${cursor?.id ?? ""}
        )
      )
    GROUP BY t.id, owner.email, s.role
    ORDER BY t.created_at, t.id
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as ManifestRow[]
  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  const items: TreeManifestItem[] = pageRows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    role: row.role,
    revision: Number(row.revision),
    syncVersion: Number(row.syncVersion),
    memberCount: Number(row.memberCount),
    createdAt:
      typeof row.createdAt === "string"
        ? new Date(row.createdAt).toISOString()
        : row.createdAt.toISOString(),
    updatedAt:
      typeof row.updatedAt === "string"
        ? new Date(row.updatedAt).toISOString()
        : row.updatedAt.toISOString(),
  }))
  const last = pageRows.at(-1)
  const body: TreeManifestResponse = {
    trees: items,
    ...(hasMore && last
      ? {
          nextCursor: encodeCursor({
            createdAt:
              typeof last.createdAt === "string"
                ? new Date(last.createdAt).toISOString()
                : last.createdAt.toISOString(),
            id: last.id,
          }),
        }
      : {}),
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}

/** Loads one selected tree instead of every tree accessible to the account. */
export async function getTreeSnapshot(
  request: Request,
  treeId: string,
): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }

  const db = getDB()
  const role = await treeRole(db, me.id, treeId)
  if (!role) return Response.json({ error: "tree not found" }, { status: 404 })
  const rows = await db
    .select({ tree: trees, ownerEmail: user.email })
    .from(trees)
    .innerJoin(user, eq(user.id, trees.ownerId))
    .where(and(eq(trees.id, treeId), isNull(trees.deletedAt)))
    .limit(1)
  const row = rows[0]
  if (!row) return Response.json({ error: "tree not found" }, { status: 404 })

  const records = (await loadActiveRecordsByTree(db, [treeId])).get(treeId)
  const body: TreeSnapshotResponse = {
    tree: treeToWire(row.tree, role, row.ownerEmail) as TreeRecordWire,
    records: records ?? {
      persons: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
    },
    syncVersion: row.tree.syncVersion,
    cursor: encodeSyncCursor({
      treeId,
      version: row.tree.syncVersion,
    }),
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}

/** Returns a bounded relationship neighborhood around one active member. */
export async function getTreeGraph(
  request: Request,
  treeId: string,
): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(request.url)
  const focusPersonId = url.searchParams.get("focusPersonId")
  const radius = Number(url.searchParams.get("radius") ?? 3)
  if (
    !isValidSyncId(treeId)
    || !isValidSyncId(focusPersonId)
    || !Number.isSafeInteger(radius)
    || radius < 0
    || radius > 6
  ) {
    return Response.json({ error: "invalid graph query" }, { status: 400 })
  }

  const db = getDB()
  const role = await treeRole(db, me.id, treeId)
  if (!role) return Response.json({ error: "tree not found" }, { status: 404 })
  const treeRows = await db
    .select({ tree: trees, ownerEmail: user.email })
    .from(trees)
    .innerJoin(user, eq(user.id, trees.ownerId))
    .where(and(eq(trees.id, treeId), isNull(trees.deletedAt)))
    .limit(1)
  const treeRow = treeRows[0]
  if (!treeRow) {
    return Response.json({ error: "tree not found" }, { status: 404 })
  }

  const reachable = await db.execute<{ personId: string; depth: number }>(sql`
    WITH RECURSIVE edges AS (
      SELECT u.first_person_id AS first_id, u.second_person_id AS second_id
      FROM tree_unions tu
      INNER JOIN unions u ON u.id = tu.union_id AND u.deleted_at IS NULL
      WHERE tu.tree_id = ${treeId} AND tu.deleted_at IS NULL
      UNION
      SELECT r.parent_person_id AS first_id, r.child_person_id AS second_id
      FROM tree_parent_child_relationships tr
      INNER JOIN parent_child_relationships r
        ON r.id = tr.parent_child_relationship_id
        AND r.deleted_at IS NULL
      WHERE tr.tree_id = ${treeId} AND tr.deleted_at IS NULL
      UNION
      SELECT second_id, first_id FROM (
        SELECT u.first_person_id AS first_id, u.second_person_id AS second_id
        FROM tree_unions tu
        INNER JOIN unions u ON u.id = tu.union_id AND u.deleted_at IS NULL
        WHERE tu.tree_id = ${treeId} AND tu.deleted_at IS NULL
        UNION
        SELECT r.parent_person_id, r.child_person_id
        FROM tree_parent_child_relationships tr
        INNER JOIN parent_child_relationships r
          ON r.id = tr.parent_child_relationship_id
          AND r.deleted_at IS NULL
        WHERE tr.tree_id = ${treeId} AND tr.deleted_at IS NULL
      ) forward_edges
    ),
    reachable(person_id, depth) AS (
      SELECT m.person_id, 0
      FROM tree_members m
      WHERE m.tree_id = ${treeId}
        AND m.person_id = ${focusPersonId}
        AND m.deleted_at IS NULL
      UNION
      SELECT edges.second_id, reachable.depth + 1
      FROM reachable
      INNER JOIN edges ON edges.first_id = reachable.person_id
      WHERE reachable.depth < ${radius}
    )
    SELECT person_id AS "personId", min(depth)::int AS depth
    FROM reachable
    GROUP BY person_id
    ORDER BY min(depth), person_id
    LIMIT 300
  `)
  const personIds = reachable.rows.map((row) => row.personId)
  if (personIds.length === 0) {
    return Response.json({ error: "person not found" }, { status: 404 })
  }
  const records = await loadActiveRecordsForPeople(db, treeId, personIds)
  const maximumDepth = Math.max(...reachable.rows.map((row) => row.depth))
  const body: TreeSnapshotResponse = {
    tree: treeToWire(treeRow.tree, role, treeRow.ownerEmail) as TreeRecordWire,
    records,
    syncVersion: treeRow.tree.syncVersion,
    cursor: encodeSyncCursor({
      treeId,
      version: treeRow.tree.syncVersion,
    }),
    partial: true,
    boundaryPersonIds: reachable.rows
      .filter((row) => row.depth === maximumDepth)
      .map((row) => row.personId),
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
