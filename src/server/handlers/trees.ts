import { and, eq, isNull, sql } from "drizzle-orm"
import { getDB } from "../../db"
import {
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
  user,
} from "../../db/schema"
import type {
  AncestorTreeLink,
  SyncRecordSet,
  TreeManifestItem,
  TreeManifestResponse,
  TreeRecordWire,
  TreeSnapshotResponse,
} from "../../sync/types"
import { treeRole } from "../acl"
import { MAX_RESPONSE_PAGE_BYTES } from "../limits"
import { requireSession } from "../session"
import {
  decodeCursorJson,
  encodeCursorJson,
  encodeSyncCursor,
} from "../sync/cursor"
import {
  loadActiveRecordsByTree,
  loadActiveRecordsForPeople,
  loadAncestorTreeLinks,
} from "../sync/pull"
import { treeToWire } from "../sync/wire"
import { isValidSyncId } from "../sync-validation"

const DEFAULT_PAGE_SIZE = 50
const MAXIMUM_PAGE_SIZE = 100

type ManifestCursor = { createdAt: string; id: string }
type SnapshotMode = "snapshot" | "graph"
type SnapshotPageCursor = {
  treeId: string
  syncVersion: number
  mode: SnapshotMode
  offset: number
  focusPersonId?: string
  radius?: number
}
type SnapshotRecords = Omit<SyncRecordSet, "trees">
type SnapshotRecordCollection = keyof SnapshotRecords
type SnapshotPageItem =
  | {
      kind: "record"
      collection: SnapshotRecordCollection
      value: SnapshotRecords[SnapshotRecordCollection][number]
    }
  | { kind: "ancestor"; value: AncestorTreeLink }

const SNAPSHOT_COLLECTIONS = [
  "persons",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const satisfies readonly SnapshotRecordCollection[]

function emptySnapshotRecords(): SnapshotRecords {
  return {
    persons: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
}

function snapshotWireKey(value: object): string {
  const wire = value as Record<string, unknown>
  return JSON.stringify([
    wire.id ?? "",
    wire.treeId ?? "",
    wire.personId ?? "",
    wire.unionId ?? "",
    wire.parentChildRelationshipId ?? "",
  ])
}

function encodeSnapshotCursor(cursor: SnapshotPageCursor): string {
  return encodeCursorJson(cursor)
}

function decodeSnapshotCursor(
  value: string | null,
  expected: Omit<SnapshotPageCursor, "syncVersion" | "offset">,
): SnapshotPageCursor | null | undefined {
  const parsed = decodeCursorJson(value) as
    | Partial<SnapshotPageCursor>
    | null
    | undefined
  if (parsed === null) return null
  if (parsed === undefined) return undefined
  if (
    parsed.treeId !== expected.treeId
    || parsed.mode !== expected.mode
    || parsed.focusPersonId !== expected.focusPersonId
    || parsed.radius !== expected.radius
    || !Number.isSafeInteger(parsed.syncVersion)
    || (parsed.syncVersion ?? -1) < 0
    || !Number.isSafeInteger(parsed.offset)
    || (parsed.offset ?? -1) < 0
  ) {
    return undefined
  }
  return parsed as SnapshotPageCursor
}

function paginateSnapshot(
  body: TreeSnapshotResponse,
  pageCursor: SnapshotPageCursor | null,
  mode: SnapshotMode,
  focusPersonId?: string,
  radius?: number,
): TreeSnapshotResponse {
  const items: SnapshotPageItem[] = []
  for (const collection of SNAPSHOT_COLLECTIONS) {
    const records = [...body.records[collection]].sort((first, second) =>
      snapshotWireKey(first).localeCompare(snapshotWireKey(second)),
    )
    for (const value of records) {
      items.push({ kind: "record", collection, value })
    }
  }
  for (const value of [...(body.ancestorTrees ?? [])].sort((first, second) =>
    `${first.personId}\0${first.treeId}`.localeCompare(
      `${second.personId}\0${second.treeId}`,
    ),
  )) {
    items.push({ kind: "ancestor", value })
  }

  const offset = pageCursor?.offset ?? 0
  const pageItems: SnapshotPageItem[] = []
  let estimatedBytes = 2_048
  for (const item of items.slice(offset)) {
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength
    if (
      pageItems.length > 0
      && estimatedBytes + itemBytes > MAX_RESPONSE_PAGE_BYTES
    ) {
      break
    }
    pageItems.push(item)
    estimatedBytes += itemBytes
  }

  const records = emptySnapshotRecords()
  const ancestorTrees: AncestorTreeLink[] = []
  for (const item of pageItems) {
    if (item.kind === "ancestor") ancestorTrees.push(item.value)
    else {
      ;(records[item.collection] as Array<typeof item.value>).push(item.value)
    }
  }
  const nextOffset = offset + pageItems.length
  return {
    ...body,
    records,
    ancestorTrees,
    ...(nextOffset < items.length
      ? {
          nextCursor: encodeSnapshotCursor({
            treeId: body.tree.id,
            syncVersion: body.syncVersion,
            mode,
            offset: nextOffset,
            ...(focusPersonId ? { focusPersonId } : {}),
            ...(radius !== undefined ? { radius } : {}),
          }),
        }
      : { nextCursor: undefined }),
  }
}

function snapshotChanged(): Response {
  return Response.json(
    { error: "snapshot changed", restartRequired: true },
    { status: 409 },
  )
}

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_PAGE_SIZE
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAXIMUM_PAGE_SIZE)
    : null
}

function encodeCursor(cursor: ManifestCursor): string {
  return encodeCursorJson(cursor)
}

function decodeCursor(value: string | null): ManifestCursor | null | undefined {
  const parsed = decodeCursorJson(value)
  if (parsed === null) return null
  if (parsed === undefined || !parsed || typeof parsed !== "object") {
    return undefined
  }
  const cursor = parsed as Record<string, unknown>
  if (
    typeof cursor.createdAt !== "string"
    || !Number.isFinite(new Date(cursor.createdAt).getTime())
    || !isValidSyncId(cursor.id)
  ) {
    return undefined
  }
  return { createdAt: cursor.createdAt, id: cursor.id }
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
    parent_graph_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(7091885217057541735)
    ),
    tree_graph_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`sync-tree:${treeId}`}, 0)
      )
    ),
    target_tree AS MATERIALIZED (
      UPDATE ${trees}
      SET "deleted_at" = (SELECT value FROM server_clock),
          "updated_at" = (SELECT value FROM server_clock),
          "revision" = "revision" + 1
      WHERE ${trees.id} = ${treeId}
        AND ${trees.ownerId} = ${me.id}
        AND ${trees.deletedAt} IS NULL
        AND EXISTS (SELECT 1 FROM parent_graph_lock)
        AND EXISTS (SELECT 1 FROM tree_graph_lock)
      RETURNING ${trees.id} AS id
    ),
    affected_parent_relationships AS MATERIALIZED (
      SELECT ${treeParentChildRelationships.parentChildRelationshipId} AS id
      FROM ${treeParentChildRelationships}
      WHERE ${treeParentChildRelationships.treeId} IN (SELECT id FROM target_tree)
        AND ${treeParentChildRelationships.deletedAt} IS NULL
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
    ),
    tombstoned_orphan_parent_relationships AS (
      UPDATE parent_child_relationships AS relationship
      SET deleted_at = (SELECT value FROM server_clock),
          updated_at = (SELECT value FROM server_clock),
          revision = relationship.revision + 1
      WHERE relationship.id IN (SELECT id FROM affected_parent_relationships)
        AND relationship.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM tree_parent_child_relationships AS association
          WHERE association.parent_child_relationship_id = relationship.id
            AND association.tree_id NOT IN (SELECT id FROM target_tree)
            AND association.deleted_at IS NULL
        )
      RETURNING relationship.id
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

/**
 * Public, unauthenticated preview of a shared tree's name so an invitee who
 * isn't signed in yet can see which family they were invited to. Tree ids are
 * unguessable UUIDs and the share model already trusts link possession, so
 * revealing only the name to a link-holder is low-risk. Returns 404 for
 * unknown/deleted trees and exposes nothing beyond `{ name }`.
 */
export async function getTreeInviteInfo(treeId: string): Promise<Response> {
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }
  const db = getDB()
  const rows = await db
    .select({ name: trees.name })
    .from(trees)
    .where(and(eq(trees.id, treeId), isNull(trees.deletedAt)))
    .limit(1)
  const row = rows[0]
  if (!row) return Response.json({ error: "tree not found" }, { status: 404 })
  return Response.json(
    { name: row.name },
    { headers: { "cache-control": "public, max-age=60" } },
  )
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
  const pageCursor = decodeSnapshotCursor(
    new URL(request.url).searchParams.get("pageCursor"),
    { treeId, mode: "snapshot" },
  )
  if (pageCursor === undefined) {
    return Response.json({ error: "invalid snapshot cursor" }, { status: 400 })
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
  if (pageCursor && pageCursor.syncVersion !== row.tree.syncVersion) {
    return snapshotChanged()
  }

  const records = (await loadActiveRecordsByTree(db, [treeId])).get(treeId)
  const ancestorTrees = await loadAncestorTreeLinks(
    db,
    me.id,
    treeId,
    (records?.persons ?? []).map((person) => person.id),
  )
  const currentTree = await db.query.trees.findFirst({
    where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
  })
  if (!currentTree || currentTree.syncVersion !== row.tree.syncVersion) {
    return snapshotChanged()
  }
  const body = paginateSnapshot(
    {
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
      ancestorTrees,
      syncVersion: row.tree.syncVersion,
      cursor: encodeSyncCursor({
        treeId,
        version: row.tree.syncVersion,
      }),
    },
    pageCursor,
    "snapshot",
  )
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
  const pageCursor = decodeSnapshotCursor(url.searchParams.get("pageCursor"), {
    treeId,
    mode: "graph",
    focusPersonId,
    radius,
  })
  if (pageCursor === undefined) {
    return Response.json({ error: "invalid graph cursor" }, { status: 400 })
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
  if (pageCursor && pageCursor.syncVersion !== treeRow.tree.syncVersion) {
    return snapshotChanged()
  }

  const reachable = await db.execute<{ personId: string; depth: number }>(sql`
    WITH RECURSIVE forward_edges AS (
      SELECT u.first_person_id AS first_id, u.second_person_id AS second_id
      FROM tree_unions tu
      INNER JOIN unions u ON u.id = tu.union_id AND u.deleted_at IS NULL
      INNER JOIN tree_members first_member
        ON first_member.tree_id = tu.tree_id
        AND first_member.person_id = u.first_person_id
        AND first_member.deleted_at IS NULL
      INNER JOIN tree_members second_member
        ON second_member.tree_id = tu.tree_id
        AND second_member.person_id = u.second_person_id
        AND second_member.deleted_at IS NULL
      WHERE tu.tree_id = ${treeId} AND tu.deleted_at IS NULL
      UNION
      SELECT r.parent_person_id AS first_id, r.child_person_id AS second_id
      FROM tree_parent_child_relationships tr
      INNER JOIN parent_child_relationships r
        ON r.id = tr.parent_child_relationship_id
        AND r.deleted_at IS NULL
      INNER JOIN tree_members parent_member
        ON parent_member.tree_id = tr.tree_id
        AND parent_member.person_id = r.parent_person_id
        AND parent_member.deleted_at IS NULL
      INNER JOIN tree_members child_member
        ON child_member.tree_id = tr.tree_id
        AND child_member.person_id = r.child_person_id
        AND child_member.deleted_at IS NULL
      WHERE tr.tree_id = ${treeId} AND tr.deleted_at IS NULL
    ),
    edges AS (
      SELECT first_id, second_id FROM forward_edges
      UNION
      SELECT second_id, first_id FROM forward_edges
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
  const ancestorTrees = await loadAncestorTreeLinks(
    db,
    me.id,
    treeId,
    personIds,
  )
  const maximumDepth = Math.max(...reachable.rows.map((row) => row.depth))
  const currentTree = await db.query.trees.findFirst({
    where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
  })
  if (!currentTree || currentTree.syncVersion !== treeRow.tree.syncVersion) {
    return snapshotChanged()
  }
  const body = paginateSnapshot(
    {
      tree: treeToWire(
        treeRow.tree,
        role,
        treeRow.ownerEmail,
      ) as TreeRecordWire,
      records,
      ancestorTrees,
      syncVersion: treeRow.tree.syncVersion,
      cursor: encodeSyncCursor({
        treeId,
        version: treeRow.tree.syncVersion,
      }),
      partial: true,
      boundaryPersonIds: reachable.rows
        .filter((row) => row.depth === maximumDepth)
        .map((row) => row.personId),
    },
    pageCursor,
    "graph",
    focusPersonId,
    radius,
  )
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
