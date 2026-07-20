import { and, eq } from "drizzle-orm"
import { getDB } from "../../db/index.js"
import { treeShares, user } from "../../db/schema.js"
import { treeRole } from "../acl.js"
import { requireSession } from "./sync.js"

interface ShareRow {
  email: string
  userId: string | null
  role: "viewer" | "editor"
  createdAt: string
  pending: boolean
}

async function requireOwner(request: Request, treeId: string) {
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

  const rows = await db
    .select()
    .from(treeShares)
    .where(eq(treeShares.treeId, treeId))

  const out: ShareRow[] = rows.map((r) => ({
    email: r.email,
    userId: r.userId,
    role: r.role as "viewer" | "editor",
    createdAt: r.createdAt.toISOString(),
    pending: r.userId === null,
  }))
  return Response.json({ shares: out })
}

/** POST /api/trees/:treeId/shares — add or update a share (owner-only). */
export async function addShare(
  request: Request,
  treeId: string,
): Promise<Response> {
  const owner = await requireOwner(request, treeId)
  if ("error" in owner)
    return Response.json({ error: owner.error }, { status: owner.status })
  const { db } = owner

  const body = (await request.json()) as {
    email?: string
    role?: "viewer" | "editor"
  }
  const email = body.email?.trim().toLowerCase()
  const role = body.role
  if (!email?.includes("@")) {
    return Response.json({ error: "valid email required" }, { status: 400 })
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

  return Response.json({ ok: true })
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

  return Response.json({ ok: true })
}
