import { and, eq, gt, inArray, isNull } from "drizzle-orm"
import { getDB } from "../../db"
import { persons, treeShares, trees, user } from "../../db/schema"
import type {
  PersonWire,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TreeWire,
} from "../../sync/types"
import type { TreeEdges } from "../../types"
import { canWrite, personRole, type Role, treeRole } from "../acl"
import { getAuth } from "../auth"

export interface SessionUser {
  id: string
  email: string
}

/** Resolve the authenticated user from a request, or null. */
export async function requireSession(
  request: Request,
): Promise<SessionUser | null> {
  const auth = getAuth()
  const result = await auth.api.getSession({ headers: request.headers })
  if (!result) return null
  return { id: result.user.id, email: result.user.email }
}

function iso(d: Date | string | null | undefined): string {
  if (!d) return ""
  return typeof d === "string" ? d : d.toISOString()
}

function personToWire(row: typeof persons.$inferSelect): PersonWire {
  return {
    id: row.id,
    name: row.name,
    dob: row.dob ?? undefined,
    dod: row.dod ?? undefined,
    gender: row.gender ?? undefined,
    location: row.location ?? undefined,
    photo: row.photo ?? undefined,
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt ? iso(row.deletedAt) : undefined,
    ownerId: row.ownerId,
  }
}

function treeToWire(
  row: typeof trees.$inferSelect,
  role: Role,
  ownerEmail?: string | null,
): TreeWire {
  return {
    id: row.id,
    name: row.name,
    edges: row.edges,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt ? iso(row.deletedAt) : undefined,
    ownerId: row.ownerId,
    ownerEmail: ownerEmail ?? undefined,
    role,
  }
}

/** GET /api/sync?since=<iso> — delta pull of own + shared records. */
export async function getSync(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const db = getDB()
  const sinceParam = new URL(request.url).searchParams.get("since")
  const since = sinceParam ? new Date(sinceParam) : new Date(0)

  // Own trees (including tombstones so deletes propagate).
  const ownTreeRows = await db
    .select()
    .from(trees)
    .where(and(eq(trees.ownerId, me.id), gt(trees.updatedAt, since)))
  const ownPersonRows = await db
    .select()
    .from(persons)
    .where(and(eq(persons.ownerId, me.id), gt(persons.updatedAt, since)))

  // Shared trees (active only — deletes come through the same row's deletedAt
  // if we ever tombstone instead of CASCADE; for now unsharing just drops the
  // share row, so the client removes the tree on its next pull diff).
  const shareRows = await db
    .select()
    .from(treeShares)
    .where(eq(treeShares.userId, me.id))

  const shared = []
  for (const share of shareRows) {
    const tree = await db.query.trees.findFirst({
      where: and(eq(trees.id, share.treeId), isNull(trees.deletedAt)),
    })
    if (!tree) continue
    const memberIds = (tree.edges as TreeEdges).members ?? []
    const memberRows =
      memberIds.length === 0
        ? []
        : await db.select().from(persons).where(inArray(persons.id, memberIds))
    const owner = await db.query.user.findFirst({
      where: eq(user.id, tree.ownerId),
    })
    const ownerEmail = owner?.email ?? null
    shared.push({
      tree: treeToWire(tree, share.role as Role, ownerEmail),
      persons: memberRows.map((row) => personToWire(row)),
      role: share.role as "viewer" | "editor",
      ownerEmail,
    })
  }

  const body: SyncPullResponse = {
    own: {
      persons: ownPersonRows.map((row) => personToWire(row)),
      trees: ownTreeRows.map((row) => treeToWire(row, "owner")),
    },
    shared,
    serverTime: new Date().toISOString(),
  }
  return Response.json(body)
}

/** POST /api/sync — batch upsert with per-record ACL + last-write-wins. */
export async function postSync(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const body = (await request.json()) as SyncPushRequest
  const db = getDB()
  const now = new Date()
  const applied = { persons: [] as string[], trees: [] as string[] }
  const skipped = { persons: [] as string[], trees: [] as string[] }

  // --- persons ---
  for (const w of body.persons ?? []) {
    const role = await personRole(db, me.id, w.id)
    // Allow if user can write OR (no existing row + user is claiming ownership).
    const existing = await db.query.persons.findFirst({
      where: eq(persons.id, w.id),
    })
    if (!existing && w.ownerId && w.ownerId === me.id && !w.deletedAt) {
      await db
        .insert(persons)
        .values({
          id: w.id,
          ownerId: me.id,
          name: w.name,
          dob: w.dob,
          dod: w.dod,
          gender: w.gender,
          location: w.location,
          photo: w.photo,
          updatedAt: new Date(w.updatedAt),
        })
        .onConflictDoNothing()
      applied.persons.push(w.id)
      continue
    }
    if (!canWrite(role)) {
      skipped.persons.push(w.id)
      continue
    }
    if (existing?.updatedAt && new Date(w.updatedAt) <= existing.updatedAt) {
      skipped.persons.push(w.id)
      continue
    }
    if (w.deletedAt) {
      // Only the owner of the person row may tombstone it.
      if (existing?.ownerId !== me.id) {
        skipped.persons.push(w.id)
        continue
      }
      await db
        .update(persons)
        .set({ deletedAt: new Date(w.deletedAt), updatedAt: now })
        .where(eq(persons.id, w.id))
      applied.persons.push(w.id)
      continue
    }
    await db
      .update(persons)
      .set({
        name: w.name,
        dob: w.dob,
        dod: w.dod,
        gender: w.gender,
        location: w.location,
        photo: w.photo,
        updatedAt: new Date(w.updatedAt),
      })
      .where(eq(persons.id, w.id))
    applied.persons.push(w.id)
  }

  // --- trees ---
  for (const w of body.trees ?? []) {
    const role = await treeRole(db, me.id, w.id)
    const existing = await db.query.trees.findFirst({
      where: eq(trees.id, w.id),
    })

    if (!existing) {
      if (w.deletedAt) {
        skipped.trees.push(w.id)
        continue
      }
      // Only the requesting user can create a tree they own.
      await db
        .insert(trees)
        .values({
          id: w.id,
          ownerId: me.id,
          name: w.name,
          edges: w.edges,
          createdAt: new Date(w.createdAt),
          updatedAt: new Date(w.updatedAt),
        })
        .onConflictDoNothing()
      applied.trees.push(w.id)
      continue
    }

    if (!canWrite(role)) {
      skipped.trees.push(w.id)
      continue
    }
    if (existing.updatedAt && new Date(w.updatedAt) <= existing.updatedAt) {
      skipped.trees.push(w.id)
      continue
    }
    if (w.deletedAt) {
      if (role !== "owner") {
        skipped.trees.push(w.id)
        continue
      }
      await db
        .update(trees)
        .set({ deletedAt: new Date(w.deletedAt), updatedAt: now })
        .where(eq(trees.id, w.id))
      applied.trees.push(w.id)
      continue
    }
    // Editors may change edges; only owners may rename.
    await db
      .update(trees)
      .set({
        edges: w.edges,
        name: role === "owner" ? w.name : existing.name,
        updatedAt: new Date(w.updatedAt),
      })
      .where(eq(trees.id, w.id))
    applied.trees.push(w.id)
  }

  const res: SyncPushResponse = {
    applied,
    skipped,
    serverTime: now.toISOString(),
  }
  return Response.json(res)
}
