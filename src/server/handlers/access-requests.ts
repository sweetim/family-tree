import { and, asc, eq, isNull } from "drizzle-orm"
import { getDB } from "../../db/index"
import { treeAccessRequests, treeShares, trees, user } from "../../db/schema"
import { treeRole } from "../acl"
import { readJsonBody } from "../request"
import { requireSession } from "../session"
import { isValidSyncId } from "../sync-validation"

const MAX_COMMENT = 500

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
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
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

async function requireOwner(request: Request, treeId: string) {
  if (!isValidSyncId(treeId)) {
    return { status: 400, error: "invalid tree id" } as const
  }
  const me = await requireSession(request)
  if (!me) return { status: 401, error: "unauthorized" } as const
  const db = getDB()
  const role = await treeRole(db, me.id, treeId)
  if (role !== "owner") return { status: 403, error: "forbidden" } as const
  return { db } as const
}

type OwnerRequestRow = {
  userId: string
  email: string
  name: string
  comment: string
  createdAt: string
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
      ),
    )
    .orderBy(asc(treeAccessRequests.createdAt))

  const out: OwnerRequestRow[] = rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  }))
  return Response.json(
    { requests: out },
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
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
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

  if (action === "approve") {
    await db.transaction(async (tx) => {
      const requester = await tx.query.user.findFirst({
        where: eq(user.id, targetUserId),
      })
      if (!requester) throw new Error("requester not found")
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
          set: { role: "viewer", userId: requester.id },
        })
      await tx
        .update(treeAccessRequests)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(
          and(
            eq(treeAccessRequests.treeId, treeId),
            eq(treeAccessRequests.userId, targetUserId),
          ),
        )
    })
  } else {
    await db
      .update(treeAccessRequests)
      .set({ status: "denied", resolvedAt: new Date() })
      .where(
        and(
          eq(treeAccessRequests.treeId, treeId),
          eq(treeAccessRequests.userId, targetUserId),
        ),
      )
  }

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}
