import { and, asc, eq, gt } from "drizzle-orm"
import { getDB } from "../../db/index"
import { treeShares, user } from "../../db/schema"
import { treeRole } from "../acl"
import { DEFAULT_LIST_PAGE_SIZE, MAXIMUM_LIST_PAGE_SIZE } from "../limits"
import { readJsonBody } from "../request"
import { requireSession } from "../session"
import { isValidSyncId } from "../sync-validation"

type ShareRow = {
  email: string
  role: "viewer" | "editor"
  createdAt: string
}

function decodeShareCursor(value: string | null): string | null | undefined {
  if (!value) return null
  try {
    const email = Buffer.from(value, "base64url").toString("utf8")
    return email && email.length <= 320 && !email.includes("\0")
      ? email
      : undefined
  } catch {
    return undefined
  }
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
  return { me, db } as const
}

/** GET /api/trees/:treeId/shares — list shares (owner-only). */
export async function listShares(
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
  const cursor = decodeShareCursor(url.searchParams.get("cursor"))
  if (
    !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || cursor === undefined
  ) {
    return Response.json({ error: "invalid pagination" }, { status: 400 })
  }
  const limit = Math.min(requestedLimit, MAXIMUM_LIST_PAGE_SIZE)

  const rows = await db
    .select()
    .from(treeShares)
    .where(
      and(
        eq(treeShares.treeId, treeId),
        cursor ? gt(treeShares.email, cursor) : undefined,
      ),
    )
    .orderBy(asc(treeShares.email))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const out: ShareRow[] = page.map((r) => ({
    email: r.email,
    role: r.role as "viewer" | "editor",
    createdAt: r.createdAt.toISOString(),
  }))
  return Response.json(
    {
      shares: out,
      ...(rows.length > limit && page.at(-1)
        ? {
            nextCursor: Buffer.from(page.at(-1)?.email ?? "").toString(
              "base64url",
            ),
          }
        : {}),
    },
    { headers: { "cache-control": "private, no-store" } },
  )
}

/** POST /api/trees/:treeId/shares — add or update a share (owner-only). */
export async function addShare(
  request: Request,
  treeId: string,
): Promise<Response> {
  const owner = await requireOwner(request, treeId)
  if ("error" in owner)
    return Response.json({ error: owner.error }, { status: owner.status })
  const { db, me } = owner

  const parsed = await readJsonBody(request, 16 * 1024)
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
    return Response.json({ error: "invalid share payload" }, { status: 400 })
  }
  const body = parsed.value as Record<string, unknown>
  if (
    Object.keys(body).some((key) => key !== "email" && key !== "role")
    || typeof body.email !== "string"
  ) {
    return Response.json({ error: "invalid share payload" }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase()
  const role = body.role
  if (
    !email
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return Response.json({ error: "valid email required" }, { status: 400 })
  }
  if (email === me.email.toLowerCase()) {
    return Response.json({ error: "owner already has access" }, { status: 400 })
  }
  if (role !== "viewer" && role !== "editor") {
    return Response.json(
      { error: "role must be viewer or editor" },
      { status: 400 },
    )
  }

  // If a user already exists with this email, bind their id immediately.
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, email),
  })

  await db
    .insert(treeShares)
    .values({
      treeId,
      email,
      userId: existingUser?.id ?? null,
      role,
    })
    .onConflictDoUpdate({
      target: [treeShares.treeId, treeShares.email],
      set: { role, userId: existingUser?.id ?? null },
    })

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}

/** DELETE /api/trees/:treeId/shares?email=<email> — revoke a share (owner-only). */
export async function removeShare(
  request: Request,
  treeId: string,
): Promise<Response> {
  const owner = await requireOwner(request, treeId)
  if ("error" in owner)
    return Response.json({ error: owner.error }, { status: owner.status })
  const { db } = owner

  const email = new URL(request.url).searchParams
    .get("email")
    ?.trim()
    .toLowerCase()
  if (!email)
    return Response.json(
      { error: "email query param required" },
      { status: 400 },
    )

  await db
    .delete(treeShares)
    .where(and(eq(treeShares.treeId, treeId), eq(treeShares.email, email)))

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}
