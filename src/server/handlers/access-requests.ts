import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm"
import { getDB } from "../../db/index"
import { treeAccessRequests, treeShares, trees, user } from "../../db/schema"
import { requireOwner, treeRole } from "../acl"
import { DEFAULT_LIST_PAGE_SIZE, MAXIMUM_LIST_PAGE_SIZE } from "../limits"
import { readJsonBody } from "../request"
import { requireSession } from "../session"
import { decodeCursorJson, encodeCursorJson } from "../sync/cursor"
import { isValidSyncId } from "../sync-validation"

const MAX_COMMENT = 500

class AccessRequestResolutionError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

type RequestStatus = {
  status: "pending" | "approved" | "denied"
  comment: string
  createdAt: string
}

/** GET /api/trees/:treeId/access-request — requester reads their own request. */
export async function getAccessRequest(
  request: Request,
  treeId: string,
): Promise<Response> {
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  const db = getDB()

  const tree = await db.query.trees.findFirst({
    where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
  })
  if (!tree) return Response.json({ error: "tree not found" }, { status: 404 })

  const row = await db.query.treeAccessRequests.findFirst({
    where: and(
      eq(treeAccessRequests.treeId, treeId),
      eq(treeAccessRequests.userId, me.id),
    ),
  })
  const out: { request: RequestStatus | null } = {
    request: row
      ? {
          status: row.status,
          comment: row.comment,
          createdAt: row.createdAt.toISOString(),
        }
      : null,
  }
  return Response.json(out, {
    headers: { "cache-control": "private, no-store" },
  })
}

/** POST /api/trees/:treeId/access-request — requester creates or reopens. */
export async function createAccessRequest(
  request: Request,
  treeId: string,
): Promise<Response> {
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  const db = getDB()

  const parsed = await readJsonBody(request, 4 * 1024)
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.error === "too-large" ? "payload too large" : "invalid JSON",
      },
      { status: parsed.error === "too-large" ? 413 : 400 },
    )
  }
  if (!parsed.value || typeof parsed.value !== "object") {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }
  const body = parsed.value as Record<string, unknown>
  if (Object.keys(body).some((key) => key !== "comment")) {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }
  if (typeof body.comment !== "string") {
    return Response.json({ error: "comment required" }, { status: 400 })
  }
  const comment = body.comment.trim()
  if (!comment) {
    return Response.json({ error: "comment required" }, { status: 400 })
  }
  if (comment.length > MAX_COMMENT) {
    return Response.json(
      { error: `comment must be ${MAX_COMMENT} characters or fewer` },
      { status: 400 },
    )
  }

  const tree = await db.query.trees.findFirst({
    where: and(eq(trees.id, treeId), isNull(trees.deletedAt)),
  })
  if (!tree) return Response.json({ error: "tree not found" }, { status: 404 })

  const role = await treeRole(db, me.id, treeId)
  if (role) {
    return Response.json(
      { error: "you already have access to this tree" },
      { status: 400 },
    )
  }

  await db
    .insert(treeAccessRequests)
    .values({ treeId, userId: me.id, comment })
    .onConflictDoUpdate({
      target: [treeAccessRequests.treeId, treeAccessRequests.userId],
      set: {
        comment,
        status: "pending",
        resolvedAt: null,
        createdAt: new Date(),
      },
    })

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}

type OwnerRequestRow = {
  userId: string
  email: string
  name: string
  comment: string
  createdAt: string
}

type OwnedAccessRequestRow = OwnerRequestRow & {
  treeId: string
  treeName: string
}

type AccessRequestCursor = { createdAt: string; userId: string }

function decodeAccessRequestCursor(
  value: string | null,
): AccessRequestCursor | null | undefined {
  const parsed = decodeCursorJson(value) as
    | Partial<AccessRequestCursor>
    | null
    | undefined
  if (parsed === null) return null
  if (parsed === undefined) return undefined
  if (
    typeof parsed.createdAt !== "string"
    || !Number.isFinite(new Date(parsed.createdAt).getTime())
    || !isValidSyncId(parsed.userId)
  ) {
    return undefined
  }
  return parsed as AccessRequestCursor
}

type OwnedAccessRequestCursor = AccessRequestCursor & { treeId: string }

export function decodeOwnedAccessRequestCursor(
  value: string | null,
): OwnedAccessRequestCursor | null | undefined {
  const parsed = decodeCursorJson(value) as
    | Partial<OwnedAccessRequestCursor>
    | null
    | undefined
  if (parsed === null) return null
  if (parsed === undefined) return undefined
  if (
    typeof parsed.createdAt !== "string"
    || !Number.isFinite(new Date(parsed.createdAt).getTime())
    || !isValidSyncId(parsed.treeId)
    || !isValidSyncId(parsed.userId)
  ) {
    return undefined
  }
  return parsed as OwnedAccessRequestCursor
}

/**
 * GET /api/access-requests — owner lists pending requests across all of their
 * trees. The total is included so callers can render a notification badge
 * without loading every page.
 */
export async function listOwnedAccessRequests(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  const db = getDB()
  const url = new URL(request.url)
  const requestedLimit = Number(
    url.searchParams.get("limit") ?? DEFAULT_LIST_PAGE_SIZE,
  )
  const cursor = decodeOwnedAccessRequestCursor(url.searchParams.get("cursor"))
  if (
    !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || cursor === undefined
  ) {
    return Response.json({ error: "invalid pagination" }, { status: 400 })
  }
  const limit = Math.min(requestedLimit, MAXIMUM_LIST_PAGE_SIZE)
  const ownerRequests = and(
    eq(trees.ownerId, me.id),
    isNull(trees.deletedAt),
    eq(treeAccessRequests.status, "pending"),
  )

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(treeAccessRequests)
      .innerJoin(trees, eq(trees.id, treeAccessRequests.treeId))
      .where(ownerRequests),
    db
      .select({
        treeId: trees.id,
        treeName: trees.name,
        userId: treeAccessRequests.userId,
        email: user.email,
        name: user.name,
        comment: treeAccessRequests.comment,
        createdAt: treeAccessRequests.createdAt,
      })
      .from(treeAccessRequests)
      .innerJoin(trees, eq(trees.id, treeAccessRequests.treeId))
      .innerJoin(user, eq(user.id, treeAccessRequests.userId))
      .where(
        and(
          ownerRequests,
          cursor
            ? or(
                gt(treeAccessRequests.createdAt, new Date(cursor.createdAt)),
                and(
                  eq(treeAccessRequests.createdAt, new Date(cursor.createdAt)),
                  gt(trees.id, cursor.treeId),
                ),
                and(
                  eq(treeAccessRequests.createdAt, new Date(cursor.createdAt)),
                  eq(trees.id, cursor.treeId),
                  gt(treeAccessRequests.userId, cursor.userId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(treeAccessRequests.createdAt),
        asc(trees.id),
        asc(treeAccessRequests.userId),
      )
      .limit(limit + 1),
  ])

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const requests: OwnedAccessRequestRow[] = page.map((row) => ({
    treeId: row.treeId,
    treeName: row.treeName,
    userId: row.userId,
    email: row.email,
    name: row.name,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  }))
  return Response.json(
    {
      requests,
      pendingCount: Number(countRows[0]?.total ?? 0),
      ...(rows.length > limit && last
        ? {
            nextCursor: encodeCursorJson({
              createdAt: last.createdAt.toISOString(),
              treeId: last.treeId,
              userId: last.userId,
            }),
          }
        : {}),
    },
    { headers: { "cache-control": "private, no-store" } },
  )
}

/** GET /api/trees/:treeId/access-requests — owner lists pending requests. */
export async function listAccessRequests(
  request: Request,
  treeId: string,
): Promise<Response> {
  const owner = await requireOwner(request, treeId)
  if ("error" in owner)
    return Response.json({ error: owner.error }, { status: owner.status })
  const { db } = owner
  const url = new URL(request.url)
  const requestedLimit = Number(
    url.searchParams.get("limit") ?? DEFAULT_LIST_PAGE_SIZE,
  )
  const cursor = decodeAccessRequestCursor(url.searchParams.get("cursor"))
  if (
    !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || cursor === undefined
  ) {
    return Response.json({ error: "invalid pagination" }, { status: 400 })
  }
  const limit = Math.min(requestedLimit, MAXIMUM_LIST_PAGE_SIZE)

  const rows = await db
    .select({
      userId: treeAccessRequests.userId,
      email: user.email,
      name: user.name,
      comment: treeAccessRequests.comment,
      createdAt: treeAccessRequests.createdAt,
    })
    .from(treeAccessRequests)
    .innerJoin(user, eq(user.id, treeAccessRequests.userId))
    .where(
      and(
        eq(treeAccessRequests.treeId, treeId),
        eq(treeAccessRequests.status, "pending"),
        cursor
          ? or(
              gt(treeAccessRequests.createdAt, new Date(cursor.createdAt)),
              and(
                eq(treeAccessRequests.createdAt, new Date(cursor.createdAt)),
                gt(treeAccessRequests.userId, cursor.userId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(treeAccessRequests.createdAt), asc(treeAccessRequests.userId))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const out: OwnerRequestRow[] = page.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  }))
  return Response.json(
    {
      requests: out,
      ...(rows.length > limit && page.at(-1)
        ? {
            nextCursor: encodeCursorJson({
              createdAt: page.at(-1)?.createdAt.toISOString(),
              userId: page.at(-1)?.userId,
            }),
          }
        : {}),
    },
    { headers: { "cache-control": "private, no-store" } },
  )
}

/**
 * POST /api/trees/:treeId/access-requests — owner resolves a request.
 * Body: { userId, action: "approve" | "deny" }. Approve grants viewer access
 * and resolves the request in one transaction.
 */
export async function resolveAccessRequest(
  request: Request,
  treeId: string,
): Promise<Response> {
  const owner = await requireOwner(request, treeId)
  if ("error" in owner)
    return Response.json({ error: owner.error }, { status: owner.status })
  const { db } = owner

  const parsed = await readJsonBody(request, 4 * 1024)
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.error === "too-large" ? "payload too large" : "invalid JSON",
      },
      { status: parsed.error === "too-large" ? 413 : 400 },
    )
  }
  if (!parsed.value || typeof parsed.value !== "object") {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }
  const body = parsed.value as Record<string, unknown>
  if (
    Object.keys(body).some((key) => key !== "userId" && key !== "action")
    || typeof body.userId !== "string"
    || !isValidSyncId(body.userId)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }
  const action = body.action
  if (action !== "approve" && action !== "deny") {
    return Response.json(
      { error: "action must be approve or deny" },
      { status: 400 },
    )
  }
  const targetUserId = body.userId

  try {
    await db.transaction(async (tx) => {
      const lockedTree = await tx.execute<{ id: string }>(sql`
        SELECT ${trees.id} AS id
        FROM ${trees}
        WHERE ${trees.id} = ${treeId}
          AND ${trees.ownerId} = ${owner.me.id}
          AND ${trees.deletedAt} IS NULL
        FOR UPDATE
      `)
      if (lockedTree.rows.length === 0) {
        throw new AccessRequestResolutionError(403, "forbidden")
      }

      const requestRows = await tx
        .select({ status: treeAccessRequests.status, requester: user })
        .from(treeAccessRequests)
        .innerJoin(user, eq(user.id, treeAccessRequests.userId))
        .where(
          and(
            eq(treeAccessRequests.treeId, treeId),
            eq(treeAccessRequests.userId, targetUserId),
          ),
        )
        .limit(1)
      const requestRow = requestRows[0]
      if (!requestRow) {
        throw new AccessRequestResolutionError(404, "request not found")
      }
      if (requestRow.status !== "pending") {
        throw new AccessRequestResolutionError(
          409,
          "request is already resolved",
        )
      }

      const resolved = await tx
        .update(treeAccessRequests)
        .set({
          status: action === "approve" ? "approved" : "denied",
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(treeAccessRequests.treeId, treeId),
            eq(treeAccessRequests.userId, targetUserId),
            eq(treeAccessRequests.status, "pending"),
          ),
        )
        .returning({ userId: treeAccessRequests.userId })
      if (resolved.length === 0) {
        throw new AccessRequestResolutionError(
          409,
          "request is already resolved",
        )
      }

      if (action === "approve") {
        const requester = requestRow.requester
        await tx
          .insert(treeShares)
          .values({
            treeId,
            email: requester.email.toLowerCase(),
            userId: requester.id,
            role: "viewer",
          })
          .onConflictDoUpdate({
            target: [treeShares.treeId, treeShares.email],
            set: {
              userId: requester.id,
              role: sql`CASE WHEN ${treeShares.role} = 'editor' THEN ${treeShares.role} ELSE 'viewer' END`,
            },
          })
      }
    })
  } catch (error) {
    if (error instanceof AccessRequestResolutionError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}
