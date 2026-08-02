import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { getDB } from "../../db"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
  unionEvents,
  unions,
  user,
} from "../../db/schema"
import type {
  SharedTreeWire,
  SyncPullResponse,
  SyncRecordSet,
  TreeRecordWire,
} from "../../sync/types"
import { MAX_RESPONSE_PAGE_BYTES } from "../limits"
import { requireSession } from "../session"
import {
  activeDependencyIds,
  isReasonableClientTimestamp,
} from "../sync-validation"
import {
  parentRelationshipToWire,
  personToWire,
  treeMemberToWire,
  treeParentRelationshipToWire,
  treeToWire,
  treeUnionToWire,
  unionEventToWire,
  unionToWire,
} from "./wire"

type TreeRecords = Omit<SyncRecordSet, "trees">

type SharedTreeMetadata = {
  tree: typeof trees.$inferSelect
  role: "viewer" | "editor"
  ownerEmail: string | null
}

type PullPageCursor = { since: string; cutoff: string; offset: number }
type PullCollection = keyof SyncRecordSet
type PullPageItem =
  | {
      scope: "own"
      collection: PullCollection
      value: SyncRecordSet[PullCollection][number]
    }
  | { scope: "shared-tree"; treeId: string }
  | {
      scope: "shared"
      treeId: string
      collection: Exclude<PullCollection, "trees">
      value: SyncRecordSet[Exclude<PullCollection, "trees">][number]
    }

const PULL_COLLECTIONS = [
  "persons",
  "trees",
  "treeMembers",
  "unions",
  "unionEvents",
  "treeUnions",
  "parentChildRelationships",
  "treeParentChildRelationships",
] as const satisfies readonly PullCollection[]

function emptyRecordSet(): SyncRecordSet {
  return { ...emptyTreeRecords(), trees: [] }
}

function pullWireKey(value: object): string {
  const wire = value as Record<string, unknown>
  return JSON.stringify([
    wire.id ?? "",
    wire.treeId ?? "",
    wire.personId ?? "",
    wire.unionId ?? "",
    wire.parentChildRelationshipId ?? "",
  ])
}

function encodePullCursor(cursor: PullPageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function decodePullCursor(
  value: string | null,
): PullPageCursor | null | undefined {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PullPageCursor>
    if (
      typeof parsed.since !== "string"
      || typeof parsed.cutoff !== "string"
      || !Number.isFinite(new Date(parsed.since).getTime())
      || !Number.isFinite(new Date(parsed.cutoff).getTime())
      || !Number.isSafeInteger(parsed.offset)
      || (parsed.offset ?? -1) < 0
    ) {
      return undefined
    }
    return parsed as PullPageCursor
  } catch {
    return undefined
  }
}

function paginatePull(
  body: SyncPullResponse,
  cursor: PullPageCursor | null,
  since: string,
): SyncPullResponse {
  const items: PullPageItem[] = []
  for (const collection of PULL_COLLECTIONS) {
    const records = [...body.own[collection]].sort((first, second) =>
      pullWireKey(first).localeCompare(pullWireKey(second)),
    )
    for (const value of records) {
      items.push({ scope: "own", collection, value })
    }
  }
  const sharedById = new Map(
    body.shared.map((shared) => [shared.tree.id, shared]),
  )
  for (const shared of [...body.shared].sort((first, second) =>
    first.tree.id.localeCompare(second.tree.id),
  )) {
    items.push({ scope: "shared-tree", treeId: shared.tree.id })
    for (const collection of PULL_COLLECTIONS) {
      if (collection === "trees") continue
      const records = [...shared[collection]].sort((first, second) =>
        pullWireKey(first).localeCompare(pullWireKey(second)),
      )
      for (const value of records) {
        items.push({
          scope: "shared",
          treeId: shared.tree.id,
          collection,
          value,
        })
      }
    }
  }

  const offset = cursor?.offset ?? 0
  const pageItems: PullPageItem[] = []
  let estimatedBytes = 1_024
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

  const own = emptyRecordSet()
  const pageShared = new Map<string, SharedTreeWire>()
  const ensureShared = (treeId: string): SharedTreeWire | undefined => {
    const current = pageShared.get(treeId)
    if (current) return current
    const source = sharedById.get(treeId)
    if (!source) return undefined
    const created: SharedTreeWire = {
      ...emptyTreeRecords(),
      tree: source.tree,
      role: source.role,
      ownerEmail: source.ownerEmail,
    }
    pageShared.set(treeId, created)
    return created
  }
  for (const item of pageItems) {
    if (item.scope === "own") {
      ;(own[item.collection] as Array<typeof item.value>).push(item.value)
    } else if (item.scope === "shared-tree") {
      ensureShared(item.treeId)
    } else {
      const shared = ensureShared(item.treeId)
      if (shared) {
        ;(shared[item.collection] as Array<typeof item.value>).push(item.value)
      }
    }
  }
  const nextOffset = offset + pageItems.length
  return {
    own,
    shared: [...pageShared.values()],
    serverTime: body.serverTime,
    ...(nextOffset < items.length
      ? {
          nextCursor: encodePullCursor({
            since,
            cutoff: body.serverTime,
            offset: nextOffset,
          }),
        }
      : {}),
  }
}

const personSyncSelection = {
  id: persons.id,
  ownerId: persons.ownerId,
  name: persons.name,
  familyName: persons.familyName,
  dob: persons.dob,
  dod: persons.dod,
  gender: persons.gender,
  birthplace: persons.birthplace,
  photo: sql<
    string | null
  >`CASE WHEN ${persons.photo} IS NULL THEN NULL ELSE 'stored' END`,
  revision: persons.revision,
  updatedAt: persons.updatedAt,
  deletedAt: persons.deletedAt,
}

function emptyTreeRecords(): TreeRecords {
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

function uniqueBy<T>(records: T[], keyFor: (record: T) => string): T[] {
  const unique = new Map<string, T>()
  for (const record of records) unique.set(keyFor(record), record)
  return [...unique.values()]
}

function groupBy<T>(
  records: T[],
  keyFor: (record: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const record of records) {
    const key = keyFor(record)
    const group = grouped.get(key) ?? []
    group.push(record)
    grouped.set(key, group)
  }
  return grouped
}

async function loadOwnedRecords(
  db: DB,
  treeIds: string[],
  since: Date,
  cutoff: Date,
): Promise<TreeRecords> {
  if (treeIds.length === 0) return emptyTreeRecords()

  const [memberRows, treeUnionRows, treeParentRows] = await Promise.all([
    db
      .select()
      .from(treeMembers)
      .where(
        and(
          inArray(treeMembers.treeId, treeIds),
          lte(treeMembers.updatedAt, cutoff),
          or(isNull(treeMembers.deletedAt), gt(treeMembers.updatedAt, since)),
        ),
      ),
    db
      .select()
      .from(treeUnions)
      .where(
        and(
          inArray(treeUnions.treeId, treeIds),
          lte(treeUnions.updatedAt, cutoff),
          or(isNull(treeUnions.deletedAt), gt(treeUnions.updatedAt, since)),
        ),
      ),
    db
      .select()
      .from(treeParentChildRelationships)
      .where(
        and(
          inArray(treeParentChildRelationships.treeId, treeIds),
          lte(treeParentChildRelationships.updatedAt, cutoff),
          or(
            isNull(treeParentChildRelationships.deletedAt),
            gt(treeParentChildRelationships.updatedAt, since),
          ),
        ),
      ),
  ])

  const personIds = [
    ...new Set(activeDependencyIds(memberRows, (row) => row.personId)),
  ]
  const unionIds = [
    ...new Set(activeDependencyIds(treeUnionRows, (row) => row.unionId)),
  ]
  const parentRelationshipIds = [
    ...new Set(
      activeDependencyIds(
        treeParentRows,
        (row) => row.parentChildRelationshipId,
      ),
    ),
  ]
  const [personRows, unionRows, unionEventRows, parentRows] = await Promise.all(
    [
      personIds.length === 0
        ? []
        : db
            .select(personSyncSelection)
            .from(persons)
            .where(
              and(
                inArray(persons.id, personIds),
                lte(persons.updatedAt, cutoff),
              ),
            ),
      unionIds.length === 0
        ? []
        : db
            .select()
            .from(unions)
            .where(
              and(inArray(unions.id, unionIds), lte(unions.updatedAt, cutoff)),
            ),
      unionIds.length === 0
        ? []
        : db
            .select()
            .from(unionEvents)
            .where(
              and(
                inArray(unionEvents.unionId, unionIds),
                lte(unionEvents.updatedAt, cutoff),
                or(
                  isNull(unionEvents.deletedAt),
                  gt(unionEvents.updatedAt, since),
                ),
              ),
            ),
      parentRelationshipIds.length === 0
        ? []
        : db
            .select()
            .from(parentChildRelationships)
            .where(
              and(
                inArray(parentChildRelationships.id, parentRelationshipIds),
                lte(parentChildRelationships.updatedAt, cutoff),
              ),
            ),
    ],
  )

  return {
    persons: personRows.map(personToWire),
    treeMembers: memberRows.map(treeMemberToWire),
    unions: unionRows.map(unionToWire),
    unionEvents: unionEventRows.map(unionEventToWire),
    treeUnions: treeUnionRows.map(treeUnionToWire),
    parentChildRelationships: parentRows.map(parentRelationshipToWire),
    treeParentChildRelationships: treeParentRows.map(
      treeParentRelationshipToWire,
    ),
  }
}

export async function loadActiveRecordsByTree(
  db: DB,
  treeIds: string[],
): Promise<Map<string, TreeRecords>> {
  if (treeIds.length === 0) return new Map()

  const [memberRows, treeUnionRows, treeParentRows] = await Promise.all([
    db
      .select()
      .from(treeMembers)
      .where(
        and(
          inArray(treeMembers.treeId, treeIds),
          isNull(treeMembers.deletedAt),
        ),
      ),
    db
      .select()
      .from(treeUnions)
      .where(
        and(inArray(treeUnions.treeId, treeIds), isNull(treeUnions.deletedAt)),
      ),
    db
      .select()
      .from(treeParentChildRelationships)
      .where(
        and(
          inArray(treeParentChildRelationships.treeId, treeIds),
          isNull(treeParentChildRelationships.deletedAt),
        ),
      ),
  ])

  const personIds = [...new Set(memberRows.map((row) => row.personId))]
  const unionIds = [...new Set(treeUnionRows.map((row) => row.unionId))]
  const parentRelationshipIds = [
    ...new Set(treeParentRows.map((row) => row.parentChildRelationshipId)),
  ]
  const [personRows, unionRows, unionEventRows, parentRows] = await Promise.all(
    [
      personIds.length === 0
        ? []
        : db
            .select(personSyncSelection)
            .from(persons)
            .where(
              and(inArray(persons.id, personIds), isNull(persons.deletedAt)),
            ),
      unionIds.length === 0
        ? []
        : db
            .select()
            .from(unions)
            .where(and(inArray(unions.id, unionIds), isNull(unions.deletedAt))),
      unionIds.length === 0
        ? []
        : db
            .select()
            .from(unionEvents)
            .where(
              and(
                inArray(unionEvents.unionId, unionIds),
                isNull(unionEvents.deletedAt),
              ),
            ),
      parentRelationshipIds.length === 0
        ? []
        : db
            .select()
            .from(parentChildRelationships)
            .where(
              and(
                inArray(parentChildRelationships.id, parentRelationshipIds),
                isNull(parentChildRelationships.deletedAt),
              ),
            ),
    ],
  )

  const membersByTree = groupBy(memberRows, (row) => row.treeId)
  const treeUnionsByTree = groupBy(treeUnionRows, (row) => row.treeId)
  const treeParentsByTree = groupBy(treeParentRows, (row) => row.treeId)
  const peopleById = new Map(personRows.map((row) => [row.id, row]))
  const unionsById = new Map(unionRows.map((row) => [row.id, row]))
  const eventsByUnion = groupBy(unionEventRows, (row) => row.unionId)
  const parentsById = new Map(parentRows.map((row) => [row.id, row]))
  const recordsByTree = new Map<string, TreeRecords>()

  for (const treeId of treeIds) {
    const treeMemberRows = membersByTree.get(treeId) ?? []
    const treePersonRows = treeMemberRows.flatMap((row) => {
      const person = peopleById.get(row.personId)
      return person ? [person] : []
    })
    const activePersonIds = new Set(treePersonRows.map((row) => row.id))
    const candidateTreeUnionRows = treeUnionsByTree.get(treeId) ?? []
    const treeUnionFactRows = candidateTreeUnionRows.flatMap((row) => {
      const union = unionsById.get(row.unionId)
      return union
        && activePersonIds.has(union.firstPersonId)
        && activePersonIds.has(union.secondPersonId)
        ? [union]
        : []
    })
    const activeUnionIds = new Set(treeUnionFactRows.map((row) => row.id))
    const candidateTreeParentRows = treeParentsByTree.get(treeId) ?? []
    const treeParentFactRows = candidateTreeParentRows.flatMap((row) => {
      const parent = parentsById.get(row.parentChildRelationshipId)
      return parent
        && activePersonIds.has(parent.parentPersonId)
        && activePersonIds.has(parent.childPersonId)
        ? [parent]
        : []
    })
    const activeParentIds = new Set(treeParentFactRows.map((row) => row.id))

    recordsByTree.set(treeId, {
      persons: treePersonRows.map(personToWire),
      treeMembers: treeMemberRows
        .filter((row) => activePersonIds.has(row.personId))
        .map(treeMemberToWire),
      unions: treeUnionFactRows.map(unionToWire),
      unionEvents: treeUnionFactRows.flatMap((row) =>
        (eventsByUnion.get(row.id) ?? []).map(unionEventToWire),
      ),
      treeUnions: candidateTreeUnionRows
        .filter((row) => activeUnionIds.has(row.unionId))
        .map(treeUnionToWire),
      parentChildRelationships: treeParentFactRows.map(
        parentRelationshipToWire,
      ),
      treeParentChildRelationships: candidateTreeParentRows
        .filter((row) => activeParentIds.has(row.parentChildRelationshipId))
        .map(treeParentRelationshipToWire),
    })
  }

  return recordsByTree
}

export async function loadActiveRecordsForPeople(
  db: DB,
  treeId: string,
  personIds: string[],
): Promise<TreeRecords> {
  if (personIds.length === 0) return emptyTreeRecords()
  const [personRows, memberRows, unionAssociationRows, parentAssociationRows] =
    await Promise.all([
      db
        .select(personSyncSelection)
        .from(persons)
        .where(and(inArray(persons.id, personIds), isNull(persons.deletedAt))),
      db
        .select()
        .from(treeMembers)
        .where(
          and(
            eq(treeMembers.treeId, treeId),
            inArray(treeMembers.personId, personIds),
            isNull(treeMembers.deletedAt),
          ),
        ),
      db
        .select({ association: treeUnions })
        .from(treeUnions)
        .innerJoin(unions, eq(unions.id, treeUnions.unionId))
        .where(
          and(
            eq(treeUnions.treeId, treeId),
            isNull(treeUnions.deletedAt),
            isNull(unions.deletedAt),
            inArray(unions.firstPersonId, personIds),
            inArray(unions.secondPersonId, personIds),
          ),
        ),
      db
        .select({ association: treeParentChildRelationships })
        .from(treeParentChildRelationships)
        .innerJoin(
          parentChildRelationships,
          eq(
            parentChildRelationships.id,
            treeParentChildRelationships.parentChildRelationshipId,
          ),
        )
        .where(
          and(
            eq(treeParentChildRelationships.treeId, treeId),
            isNull(treeParentChildRelationships.deletedAt),
            isNull(parentChildRelationships.deletedAt),
            inArray(parentChildRelationships.parentPersonId, personIds),
            inArray(parentChildRelationships.childPersonId, personIds),
          ),
        ),
    ])
  const treeUnionRows = unionAssociationRows.map((row) => row.association)
  const treeParentRows = parentAssociationRows.map((row) => row.association)
  const unionIds = treeUnionRows.map((row) => row.unionId)
  const parentIds = treeParentRows.map((row) => row.parentChildRelationshipId)
  const [unionRows, eventRows, parentRows] = await Promise.all([
    unionIds.length > 0
      ? db.select().from(unions).where(inArray(unions.id, unionIds))
      : [],
    unionIds.length > 0
      ? db
          .select()
          .from(unionEvents)
          .where(
            and(
              inArray(unionEvents.unionId, unionIds),
              isNull(unionEvents.deletedAt),
            ),
          )
      : [],
    parentIds.length > 0
      ? db
          .select()
          .from(parentChildRelationships)
          .where(inArray(parentChildRelationships.id, parentIds))
      : [],
  ])
  return {
    persons: personRows.map(personToWire),
    treeMembers: memberRows.map(treeMemberToWire),
    unions: unionRows.map(unionToWire),
    unionEvents: eventRows.map(unionEventToWire),
    treeUnions: treeUnionRows.map(treeUnionToWire),
    parentChildRelationships: parentRows.map(parentRelationshipToWire),
    treeParentChildRelationships: treeParentRows.map(
      treeParentRelationshipToWire,
    ),
  }
}

type AncestorLinkRow = {
  personId: string
  treeId: string
  treeCreatedAt: string
}

/**
 * The earliest accessible "ancestor family" tree for each visible person — a
 * tree (other than the current one) that holds both the person and at least one
 * of their parents. The client resolves the full tree metadata from its index,
 * so we only need to return the link. Keeping this separate from the synced
 * records avoids pre-populating partial membership into the store, which would
 * otherwise render a lone, disconnected card when the user opens that tree
 * before its own snapshot loads.
 */
export async function loadAncestorTreeLinks(
  db: DB,
  userId: string,
  treeId: string,
  personIds: string[],
): Promise<Array<{ personId: string; treeId: string }>> {
  if (personIds.length === 0) return []
  const result = await db.execute<AncestorLinkRow>(sql`
    SELECT
      rel.child_person_id AS "personId",
      tpr.tree_id AS "treeId",
      at.created_at AS "treeCreatedAt"
    FROM parent_child_relationships rel
    INNER JOIN tree_parent_child_relationships tpr
      ON tpr.parent_child_relationship_id = rel.id
      AND tpr.deleted_at IS NULL
    INNER JOIN tree_members child_member
      ON child_member.tree_id = tpr.tree_id
      AND child_member.person_id = rel.child_person_id
      AND child_member.deleted_at IS NULL
    INNER JOIN tree_members parent_member
      ON parent_member.tree_id = tpr.tree_id
      AND parent_member.person_id = rel.parent_person_id
      AND parent_member.deleted_at IS NULL
    INNER JOIN trees at
      ON at.id = tpr.tree_id
      AND at.deleted_at IS NULL
    WHERE rel.deleted_at IS NULL
      AND rel.child_person_id IN (${sql.join(
        personIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND tpr.tree_id <> ${treeId}
      AND (
        at.owner_id = ${userId}
        OR EXISTS (
          SELECT 1
          FROM tree_shares ats
          WHERE ats.tree_id = at.id AND ats.user_id = ${userId}
        )
      )
  `)
  if (result.rows.length === 0) return []
  const earliest = new Map<string, { treeId: string; treeCreatedAt: string }>()
  for (const row of result.rows) {
    const existing = earliest.get(row.personId)
    if (
      !existing
      || row.treeCreatedAt < existing.treeCreatedAt
      || (row.treeCreatedAt === existing.treeCreatedAt
        && row.treeId < existing.treeId)
    ) {
      earliest.set(row.personId, {
        treeId: row.treeId,
        treeCreatedAt: row.treeCreatedAt,
      })
    }
  }
  return [...earliest.entries()].map(([personId, { treeId }]) => ({
    personId,
    treeId,
  }))
}

/** GET /api/sync?since=<iso> with query count independent of tree count. */
export async function getSync(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams
  const sinceParam = searchParams.get("since")
  const pageCursor = decodePullCursor(searchParams.get("pageCursor"))
  if (
    pageCursor === undefined
    || (pageCursor && pageCursor.since !== sinceParam)
  ) {
    return Response.json({ error: "invalid sync cursor" }, { status: 400 })
  }
  const requestTime = new Date()
  if (sinceParam && !isReasonableClientTimestamp(sinceParam, requestTime)) {
    return Response.json({ error: "invalid since timestamp" }, { status: 400 })
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const since = sinceParam ? new Date(sinceParam) : new Date(0)
  const cutoff = pageCursor ? new Date(pageCursor.cutoff) : new Date()
  const db = getDB()
  const [ownedTreeRows, ownedPersonRows, sharedMetadataRows] =
    await Promise.all([
      db.select().from(trees).where(eq(trees.ownerId, me.id)),
      db
        .select(personSyncSelection)
        .from(persons)
        .where(
          and(
            eq(persons.ownerId, me.id),
            gt(persons.updatedAt, since),
            lte(persons.updatedAt, cutoff),
          ),
        ),
      db
        .select({
          id: trees.id,
          ownerId: trees.ownerId,
          name: trees.name,
          createdAt: trees.createdAt,
          revision: trees.revision,
          syncVersion: trees.syncVersion,
          updatedAt: trees.updatedAt,
          deletedAt: trees.deletedAt,
          role: treeShares.role,
          ownerEmail: user.email,
        })
        .from(treeShares)
        .innerJoin(
          trees,
          and(eq(trees.id, treeShares.treeId), isNull(trees.deletedAt)),
        )
        .innerJoin(user, eq(user.id, trees.ownerId))
        .where(eq(treeShares.userId, me.id)),
    ])

  const ownedTreeIds = ownedTreeRows
    .filter((tree) => !tree.deletedAt && tree.updatedAt <= cutoff)
    .map((tree) => tree.id)
  const sharedMetadataByTree = new Map<string, SharedTreeMetadata>()
  for (const row of sharedMetadataRows) {
    if (row.ownerId === me.id) continue
    const existing = sharedMetadataByTree.get(row.id)
    if (existing?.role === "editor") continue
    sharedMetadataByTree.set(row.id, {
      tree: {
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        createdAt: row.createdAt,
        revision: row.revision,
        syncVersion: row.syncVersion,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      },
      role: row.role,
      ownerEmail: row.ownerEmail,
    })
  }

  const sharedTreeIds = [...sharedMetadataByTree.keys()]
  const [ownedRecords, sharedRecordsByTree] = await Promise.all([
    loadOwnedRecords(db, ownedTreeIds, since, cutoff),
    loadActiveRecordsByTree(db, sharedTreeIds),
  ])
  const own: SyncRecordSet = {
    ...ownedRecords,
    persons: uniqueBy(
      [...ownedPersonRows.map(personToWire), ...ownedRecords.persons],
      (record) => record.id,
    ),
    trees: ownedTreeRows
      .filter((row) => row.updatedAt > since && row.updatedAt <= cutoff)
      .map((row) => treeToWire(row, "owner")),
  }
  const shared: SharedTreeWire[] = sharedTreeIds.map((treeId) => {
    const metadata = sharedMetadataByTree.get(treeId) as SharedTreeMetadata
    return {
      ...(sharedRecordsByTree.get(treeId) ?? emptyTreeRecords()),
      tree: treeToWire(
        metadata.tree,
        metadata.role,
        metadata.ownerEmail,
      ) as TreeRecordWire,
      role: metadata.role,
      ownerEmail: metadata.ownerEmail,
    }
  })
  const body = paginatePull(
    {
      own,
      shared,
      serverTime: cutoff.toISOString(),
    },
    pageCursor,
    sinceParam ?? new Date(0).toISOString(),
  )
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
