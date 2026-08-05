import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { getDB } from "../../db/index"
import { treeAccessRequests, treeShares, trees, user } from "../../db/schema"
import { requireOwner } from "../acl"
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

  // Revoking access also clears the requester's access request, so a stale
  // "approved" row can't keep reporting access that no longer exists.
  const account = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  })

  await db.transaction(async (transaction) => {
    await transaction
      .delete(treeShares)
      .where(and(eq(treeShares.treeId, treeId), eq(treeShares.email, email)))
    if (account) {
      await transaction
        .delete(treeAccessRequests)
        .where(
          and(
            eq(treeAccessRequests.treeId, treeId),
            eq(treeAccessRequests.userId, account.id),
          ),
        )
    }
  })

  return Response.json(
    { ok: true },
    { headers: { "cache-control": "private, no-store" } },
  )
}

type RawOwnerShareRow = {
  email: string
  userId: string | null
  role: string
  treeId: string
  treeName: string
  userName: string | null
}

type OwnerShareTree = {
  treeId: string
  treeName: string
  role: "viewer" | "editor"
}

type OwnerShareEntry = {
  email: string
  name: string | null
  pending: boolean
  trees: OwnerShareTree[]
}

export function decodeOwnerShareCursor(
  value: string | null,
): string | null | undefined {
  return decodeShareCursor(value)
}

type OwnerShareMutation = {
  email: string
  treeId: string
  role: "viewer" | "editor" | null
}

type OwnerShareMutationResult = OwnerShareMutation & {
  name: string | null
  pending: boolean
}

function validShareEmail(value: unknown): value is string {
  const email = typeof value === "string" ? value.trim() : ""
  return (
    email.length > 0
    && email.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
}

/** GET /api/shares — paginated shares across trees owned by the caller, grouped by email. */
export async function listOwnerShares(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const db = getDB()
  const url = new URL(request.url)
  const requestedLimit = Number(
    url.searchParams.get("limit") ?? DEFAULT_LIST_PAGE_SIZE,
  )
  const cursor = decodeOwnerShareCursor(url.searchParams.get("cursor"))
  if (
    !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || cursor === undefined
  ) {
    return Response.json({ error: "invalid pagination" }, { status: 400 })
  }
  const limit = Math.min(requestedLimit, MAXIMUM_LIST_PAGE_SIZE)
  const result = await db.execute(sql<RawOwnerShareRow>`
    WITH page_emails AS (
      SELECT share.email
      FROM tree_shares share
      INNER JOIN trees t ON t.id = share.tree_id
      WHERE t.owner_id = ${me.id}
        AND t.deleted_at IS NULL
        ${cursor ? sql`AND share.email > ${cursor}` : sql``}
      GROUP BY share.email
      ORDER BY share.email
      LIMIT ${limit + 1}
    )
    SELECT
      share.email       AS email,
      share.user_id     AS "userId",
      share.role        AS role,
      share.tree_id     AS "treeId",
      t.name            AS "treeName",
      u.name            AS "userName"
    FROM tree_shares share
    INNER JOIN trees t ON t.id = share.tree_id
    LEFT JOIN "user" u ON u.id = share.user_id
    WHERE share.email IN (SELECT email FROM page_emails)
    ORDER BY share.email, t.name
  `)

  const emails = [
    ...new Set((result.rows as RawOwnerShareRow[]).map((row) => row.email)),
  ]
  const pageEmails = new Set(emails.slice(0, limit))
  const byEmail = new Map<string, OwnerShareEntry>()
  for (const row of result.rows as RawOwnerShareRow[]) {
    if (!pageEmails.has(row.email)) continue
    let entry = byEmail.get(row.email)
    if (!entry) {
      entry = {
        email: row.email,
        name: row.userName ?? null,
        pending: row.userId == null,
        trees: [],
      }
      byEmail.set(row.email, entry)
    }
    entry.trees.push({
      treeId: row.treeId,
      treeName: row.treeName,
      role: row.role as "viewer" | "editor",
    })
  }

  return Response.json(
    {
      entries: [...byEmail.values()],
      ...(emails.length > limit && pageEmails.size > 0
        ? {
            nextCursor: Buffer.from([...pageEmails].at(-1) ?? "").toString(
              "base64url",
            ),
          }
        : {}),
    },
    { headers: { "cache-control": "private, no-store" } },
  )
}

/** PATCH /api/shares — atomically apply owner-scoped share changes. */
export async function mutateOwnerShares(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const parsed = await readJsonBody(request, 64 * 1024)
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
    Object.keys(body).some((key) => key !== "changes")
    || !Array.isArray(body.changes)
    || body.changes.length === 0
    || body.changes.length > MAXIMUM_LIST_PAGE_SIZE
  ) {
    return Response.json({ error: "invalid share payload" }, { status: 400 })
  }

  const changes: OwnerShareMutation[] = []
  const keys = new Set<string>()
  for (const value of body.changes) {
    if (!value || typeof value !== "object") {
      return Response.json({ error: "invalid share payload" }, { status: 400 })
    }
    const change = value as Record<string, unknown>
    if (
      Object.keys(change).some(
        (key) => key !== "email" && key !== "treeId" && key !== "role",
      )
      || !validShareEmail(change.email)
      || typeof change.treeId !== "string"
      || !isValidSyncId(change.treeId)
      || (change.role !== "viewer"
        && change.role !== "editor"
        && change.role !== null)
    ) {
      return Response.json({ error: "invalid share payload" }, { status: 400 })
    }
    const email = change.email.trim().toLowerCase()
    if (!email || email === me.email.toLowerCase()) {
      return Response.json({ error: "invalid share payload" }, { status: 400 })
    }
    const key = `${change.treeId}:${email}`
    if (keys.has(key)) {
      return Response.json({ error: "duplicate share change" }, { status: 400 })
    }
    keys.add(key)
    changes.push({ email, treeId: change.treeId, role: change.role })
  }

  const db = getDB()
  const treeIds = [...new Set(changes.map((change) => change.treeId))]
  const ownedTrees = await db
    .select({ id: trees.id })
    .from(trees)
    .where(
      and(
        eq(trees.ownerId, me.id),
        isNull(trees.deletedAt),
        inArray(trees.id, treeIds),
      ),
    )
  if (ownedTrees.length !== treeIds.length) {
    return Response.json({ error: "tree not found" }, { status: 404 })
  }

  const upserts = changes.filter(
    (change): change is OwnerShareMutation & { role: "viewer" | "editor" } =>
      change.role !== null,
  )
  const results = await db.transaction(async (transaction) => {
    const userEmails = [...new Set(changes.map((change) => change.email))]
    const users = userEmails.length
      ? await transaction
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(inArray(user.email, userEmails))
      : []
    const userByEmail = new Map(
      users.map((account) => [account.email, account]),
    )

    if (upserts.length > 0) {
      await transaction
        .insert(treeShares)
        .values(
          upserts.map((change) => ({
            treeId: change.treeId,
            email: change.email,
            userId: userByEmail.get(change.email)?.id ?? null,
            role: change.role,
          })),
        )
        .onConflictDoUpdate({
          target: [treeShares.treeId, treeShares.email],
          set: {
            role: sql`excluded.role`,
            userId: sql`excluded.user_id`,
          },
        })
    }

    const removals = changes.filter(
      (change): change is OwnerShareMutation & { role: null } =>
        change.role === null,
    )
    if (removals.length > 0) {
      await transaction
        .delete(treeShares)
        .where(
          or(
            ...removals.map((change) =>
              and(
                eq(treeShares.treeId, change.treeId),
                eq(treeShares.email, change.email),
              ),
            ),
          ),
        )

      // Clear access requests for revoked shares so an "approved" request
      // can't linger after access has been taken away.
      const revokedAccessRequests = removals
        .map((change) => {
          const userId = userByEmail.get(change.email)?.id
          return userId ? { treeId: change.treeId, userId } : null
        })
        .filter(
          (entry): entry is { treeId: string; userId: string } =>
            entry !== null,
        )
      if (revokedAccessRequests.length > 0) {
        await transaction
          .delete(treeAccessRequests)
          .where(
            or(
              ...revokedAccessRequests.map((entry) =>
                and(
                  eq(treeAccessRequests.treeId, entry.treeId),
                  eq(treeAccessRequests.userId, entry.userId),
                ),
              ),
            ),
          )
      }
    }

    return changes.map<OwnerShareMutationResult>((change) => {
      const account = userByEmail.get(change.email)
      return {
        ...change,
        name: account?.name ?? null,
        pending: !account,
      }
    })
  })

  return Response.json(
    { changes: results },
    { headers: { "cache-control": "private, no-store" } },
  )
}
