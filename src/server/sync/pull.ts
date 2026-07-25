import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm"
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
            .select()
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

async function loadSharedRecordsByTree(
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
            .select()
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

/** GET /api/sync?since=<iso> with query count independent of tree count. */
export async function getSync(request: Request): Promise<Response> {
  const sinceParam = new URL(request.url).searchParams.get("since")
  const requestTime = new Date()
  if (sinceParam && !isReasonableClientTimestamp(sinceParam, requestTime)) {
    return Response.json({ error: "invalid since timestamp" }, { status: 400 })
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const since = sinceParam ? new Date(sinceParam) : new Date(0)
  const cutoff = new Date()
  const db = getDB()
  const [ownedTreeRows, ownedPersonRows, sharedMetadataRows] =
    await Promise.all([
      db.select().from(trees).where(eq(trees.ownerId, me.id)),
      db
        .select()
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
    loadSharedRecordsByTree(db, sharedTreeIds),
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
  const body: SyncPullResponse = {
    own,
    shared,
    serverTime: cutoff.toISOString(),
  }
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  })
}
