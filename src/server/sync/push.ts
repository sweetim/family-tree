import { and, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { getDB } from "../../db/index"
import {
  mutationReceipts,
  parentChildRelationships,
  persons,
  syncChanges,
  treeMembers,
  treeParentChildRelationships,
  treeShares,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type {
  SyncAppliedIds,
  SyncMutationResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncRecordSet,
} from "../../sync/types"
import type { ParentChildRelationshipType } from "../../types"
import { canWrite, personRole, type Role, treeRole } from "../acl"
import { deletePhoto, isPhotoDataUrl } from "../blob"
import {
  MAX_RESPONSE_PAGE_BYTES,
  MAX_TREE_MEMBERS,
  MAX_TREE_RELATED_RECORDS,
} from "../limits"
import { MAX_SYNC_BODY_BYTES, readJsonBody } from "../request"
import { requireSession, type SessionUser } from "../session"
import {
  associationKey,
  clientCanTombstone,
  GENDERS,
  isCanonicalUnion,
  isValidIsoDate,
  isValidSyncId,
  isValidSyncPushRequest,
  PARENT_RELATIONSHIP_TYPES,
  UNION_EVENT_TYPES,
} from "../sync-validation"
import {
  tombstoneOrphanParentRelationships,
  tombstoneOwnedTree,
} from "../tree-deletion"
import {
  type ActivePeopleExist,
  activeTreeHasMembers,
  canWriteExistingParentRelationship,
  canWriteExistingUnion,
  hasWritableTreeContaining,
  type RoleForTree,
} from "./push-authorize"
import {
  discardStagedPhotos,
  finalizeCommittedPhotos,
  type PhotoLifecycle,
  preuploadMutationPhotos,
  resolvePreuploadedPhoto,
  resolvePreuploadedPhotoUpdate,
} from "./push-photos"
import {
  tombstonePersonCascade,
  tombstonePersonReferencesInTrees,
} from "./push-tombstone"
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

type SyncCollection = keyof SyncAppliedIds
type CascadedTreeReferences = {
  unionIds: Set<string>
  parentRelationshipIds: Set<string>
  treeUnionKeys: Set<string>
  treeParentRelationshipKeys: Set<string>
}
type RoleForPerson = (personId: string) => Promise<Role | null>
type MutationContext = {
  db: DB
  me: SessionUser
  body: SyncPushRequest
  mutationId: string | null
  serverTime: Date
  quotaTreeIds: string[]
  usageBefore: Map<string, TreeUsage>
  roleForTree: RoleForTree
  roleForPerson: RoleForPerson
  treeRoleCache: Map<string, Promise<Role | null>>
  personRoleCache: Map<string, Promise<Role | null>>
  activePeopleExistForRequest: ActivePeopleExist
  ownedPersonIds: Set<string>
  photoLifecycle: PhotoLifecycle
}
type MutationApplicationState = {
  applied: SyncAppliedIds
  skipped: SyncAppliedIds
  missingParentRelationshipIds: Set<string>
  cascadedReferences: CascadedTreeReferences
  orphanCandidateRelationshipIds: Set<string>
  parentRelationshipIdAlias: Map<
    string,
    { id: string; revision: number; type: ParentChildRelationshipType }
  >
  parentAssociationAliases: Map<
    string,
    { parentChildRelationshipId: string; revision: number }
  >
}
type MutationConflict = {
  mutationId: string
  serverTime: string
  skipped: SyncAppliedIds
  retryable: boolean
  reason: NonNullable<SyncMutationResponse["conflict"]>["reason"]
  missingDependencies?: NonNullable<
    SyncMutationResponse["conflict"]
  >["missingDependencies"]
  limit?: NonNullable<SyncMutationResponse["conflict"]>["limit"]
}

type MutationOutcome = {
  conflict?: MutationConflict
}

function emptyAppliedIds(): SyncAppliedIds {
  return {
    persons: [],
    trees: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
}

function createMutationApplicationState(): MutationApplicationState {
  return {
    applied: emptyAppliedIds(),
    skipped: emptyAppliedIds(),
    missingParentRelationshipIds: new Set(),
    cascadedReferences: emptyCascadedTreeReferences(),
    orphanCandidateRelationshipIds: new Set(),
    parentRelationshipIdAlias: new Map(),
    parentAssociationAliases: new Map(),
  }
}

function requestIds(body: SyncPushRequest): SyncAppliedIds {
  return {
    persons: body.persons.map((wire) => wire.id),
    trees: body.trees.map((wire) => wire.id),
    treeMembers: body.treeMembers.map((wire) =>
      associationKey(wire.treeId, wire.personId),
    ),
    unions: body.unions.map((wire) => wire.id),
    unionEvents: body.unionEvents.map((wire) => wire.id),
    treeUnions: body.treeUnions.map((wire) =>
      associationKey(wire.treeId, wire.unionId),
    ),
    parentChildRelationships: body.parentChildRelationships.map(
      (wire) => wire.id,
    ),
    treeParentChildRelationships: body.treeParentChildRelationships.map(
      (wire) => associationKey(wire.treeId, wire.parentChildRelationshipId),
    ),
  }
}

function classify(
  applied: SyncAppliedIds,
  skipped: SyncAppliedIds,
  collection: SyncCollection,
  id: string,
  wasApplied: boolean,
): void {
  ;(wasApplied ? applied : skipped)[collection].push(id)
}

function wireTimestamp(wire: { updatedAt: string }): Date | null {
  const value = new Date(wire.updatedAt)
  return Number.isFinite(value.getTime()) ? value : null
}

function wireCreatedAt(wire: { createdAt: string }): Date | null {
  const value = new Date(wire.createdAt)
  return Number.isFinite(value.getTime()) ? value : null
}

function wireRevision(wire: { revision?: number }): number | null {
  return Number.isSafeInteger(wire.revision) && (wire.revision ?? 0) > 0
    ? (wire.revision as number)
    : null
}

function hasClassifiedRecords(ids: SyncAppliedIds): boolean {
  return Object.values(ids).some((records) => records.length > 0)
}

function isValidMutationId(value: string | null): value is string {
  return Boolean(value && isValidSyncId(value))
}

function mutationTouchesParentGraph(body: SyncPushRequest): boolean {
  return (
    body.parentChildRelationships.length > 0
    || body.treeParentChildRelationships.length > 0
    || body.persons.some((wire) => "deletedAt" in wire)
    || body.trees.some((wire) => "deletedAt" in wire)
    || body.treeMembers.some((wire) => "deletedAt" in wire)
  )
}

// Serializes concurrent active parent-graph mutations. The value exceeds JS
// Number.MAX_SAFE_INTEGER, so it is inlined as a raw SQL literal and must never
// be bound as a parameter. It must match the trigger in
// drizzle/0001_normalize_family_data.sql exactly.
const PARENT_GRAPH_INTEGRITY_LOCK = "7091885217057541735"

async function lockMutationGraph(
  db: DB,
  body: SyncPushRequest,
): Promise<string[]> {
  const unionIds = [
    ...new Set([
      ...body.unions.map((wire) => wire.id),
      ...body.unionEvents.flatMap((wire) =>
        "unionId" in wire ? [wire.unionId] : [],
      ),
      ...body.treeUnions.map((wire) => wire.unionId),
    ]),
  ].sort()
  // Acquire every lock the mutation needs in as few round-trips as possible
  // instead of one await per lock. Postgres evaluates a SELECT list
  // left-to-right, so listing the global lock before the per-union locks
  // preserves the original acquire order and keeps the lock-ordering contract
  // (global -> union -> tree) deadlock-safe.
  const leadingLocks: SQL[] = []
  if (mutationTouchesParentGraph(body)) {
    leadingLocks.push(
      sql`pg_advisory_xact_lock(${sql.raw(PARENT_GRAPH_INTEGRITY_LOCK)})`,
    )
  }
  for (const unionId of unionIds) {
    leadingLocks.push(
      sql`pg_advisory_xact_lock(hashtextextended(${`sync-union:${unionId}`}, 0))`,
    )
  }
  if (leadingLocks.length > 0) {
    await db.execute(sql`SELECT ${sql.join(leadingLocks, sql`, `)}`)
  }
  const associatedTrees =
    unionIds.length > 0
      ? await db
          .select({ treeId: treeUnions.treeId })
          .from(treeUnions)
          .where(
            and(
              inArray(treeUnions.unionId, unionIds),
              isNull(treeUnions.deletedAt),
            ),
          )
      : []
  const treeIds = [
    ...new Set([
      ...body.trees.map((wire) => wire.id),
      ...body.treeMembers.map((wire) => wire.treeId),
      ...body.treeUnions.map((wire) => wire.treeId),
      ...body.treeParentChildRelationships.map((wire) => wire.treeId),
      ...associatedTrees.map((row) => row.treeId),
    ]),
  ].sort()
  if (treeIds.length > 0) {
    await db.execute(
      sql`SELECT ${sql.join(
        treeIds.map(
          (treeId) =>
            sql`pg_advisory_xact_lock(hashtextextended(${`sync-tree:${treeId}`}, 0))`,
        ),
        sql`, `,
      )}`,
    )
  }
  return treeIds
}

type TreeUsage = { members: number; relatedRecords: number }

async function loadTreeUsage(
  db: DB,
  treeIds: string[],
): Promise<Map<string, TreeUsage>> {
  if (treeIds.length === 0) return new Map()
  const values = sql.join(
    treeIds.map((treeId) => sql`${treeId}`),
    sql`, `,
  )
  const result = await db.execute<{
    treeId: string
    members: string | number
    relatedRecords: string | number
  }>(sql`
    SELECT scope.tree_id AS "treeId",
      (
        SELECT count(*)
        FROM tree_members AS membership
        WHERE membership.tree_id = scope.tree_id
          AND membership.deleted_at IS NULL
      ) AS members,
      (
        2 * (
          SELECT count(*)
          FROM tree_unions AS association
          INNER JOIN unions AS relationship
            ON relationship.id = association.union_id
            AND relationship.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
        + (
          SELECT count(*)
          FROM tree_unions AS association
          INNER JOIN unions AS relationship
            ON relationship.id = association.union_id
            AND relationship.deleted_at IS NULL
          INNER JOIN union_events AS event
            ON event.union_id = relationship.id
            AND event.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
        + 2 * (
          SELECT count(*)
          FROM tree_parent_child_relationships AS association
          INNER JOIN parent_child_relationships AS relationship
            ON relationship.id = association.parent_child_relationship_id
            AND relationship.deleted_at IS NULL
          WHERE association.tree_id = scope.tree_id
            AND association.deleted_at IS NULL
        )
      ) AS "relatedRecords"
    FROM unnest(ARRAY[${values}]::text[]) AS scope(tree_id)
  `)
  return new Map(
    result.rows.map((row) => [
      row.treeId,
      {
        members: Number(row.members),
        relatedRecords: Number(row.relatedRecords),
      },
    ]),
  )
}

async function collectAuthoritativeConflictRecords(
  db: DB,
  userId: string,
  body: SyncPushRequest,
): Promise<SyncRecordSet> {
  const changes = await collectMutationChanges(db, body, new Map())
  const result = emptyRecordSet()
  const treeIds = [...changes.keys()]
  const readableTreeIds = new Set<string>()
  if (treeIds.length > 0) {
    const rows = await db
      .select({ id: trees.id })
      .from(trees)
      .leftJoin(
        treeShares,
        and(eq(treeShares.treeId, trees.id), eq(treeShares.userId, userId)),
      )
      .where(
        and(
          inArray(trees.id, treeIds),
          isNull(trees.deletedAt),
          or(eq(trees.ownerId, userId), eq(treeShares.userId, userId)),
        ),
      )
    for (const row of rows) readableTreeIds.add(row.id)
  }

  const append = (records: SyncRecordSet) => {
    for (const collection of Object.keys(result) as Array<
      keyof SyncRecordSet
    >) {
      const existing = new Set(
        result[collection].map((wire) => JSON.stringify(wire)),
      )
      for (const wire of records[collection]) {
        const key = JSON.stringify(wire)
        if (!existing.has(key)) {
          result[collection].push(wire as never)
          existing.add(key)
        }
      }
    }
  }

  for (const [treeId, records] of changes) {
    if (readableTreeIds.has(treeId)) append(records)
  }

  const requestedPersonIds = [...new Set(body.persons.map((wire) => wire.id))]
  const requestedTreeIds = [...new Set(body.trees.map((wire) => wire.id))]
  const [ownedPeople, ownedTrees] = await Promise.all([
    requestedPersonIds.length > 0
      ? db
          .select()
          .from(persons)
          .where(
            and(
              inArray(persons.id, requestedPersonIds),
              eq(persons.ownerId, userId),
            ),
          )
      : [],
    requestedTreeIds.length > 0
      ? db
          .select()
          .from(trees)
          .where(
            and(inArray(trees.id, requestedTreeIds), eq(trees.ownerId, userId)),
          )
      : [],
  ])
  append({
    ...emptyRecordSet(),
    persons: ownedPeople.map(personToWire),
    trees: ownedTrees.map((tree) => treeToWire(tree, "owner")),
  })
  return result
}

function emptyRecordSet(): SyncRecordSet {
  return {
    persons: [],
    trees: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
}

function emptyCascadedTreeReferences(): CascadedTreeReferences {
  return {
    unionIds: new Set(),
    parentRelationshipIds: new Set(),
    treeUnionKeys: new Set(),
    treeParentRelationshipKeys: new Set(),
  }
}

async function collectMutationChanges(
  db: DB,
  body: SyncPushRequest,
  parentAliases: ReadonlyMap<
    string,
    {
      id: string
      revision: number
      type: ParentChildRelationshipType
    }
  >,
  cascadedReferences: CascadedTreeReferences = emptyCascadedTreeReferences(),
): Promise<Map<string, SyncRecordSet>> {
  const personIds = new Set([
    ...body.persons.map((wire) => wire.id),
    ...body.treeMembers.map((wire) => wire.personId),
  ])
  const deletedPersonIds = body.persons
    .filter((wire) => "deletedAt" in wire)
    .map((wire) => wire.id)
  const deletedPersonIdSet = new Set(deletedPersonIds)
  const explicitMemberKeys = new Set(
    body.treeMembers.map((wire) => associationKey(wire.treeId, wire.personId)),
  )
  const explicitTreeUnionKeys = new Set([
    ...body.treeUnions.map((wire) => associationKey(wire.treeId, wire.unionId)),
    ...cascadedReferences.treeUnionKeys,
  ])
  const explicitTreeParentKeys = new Set([
    ...body.treeParentChildRelationships.map((wire) =>
      associationKey(
        wire.treeId,
        parentAliases.get(wire.parentChildRelationshipId)?.id
          ?? wire.parentChildRelationshipId,
      ),
    ),
    ...cascadedReferences.treeParentRelationshipKeys,
  ])
  const unionIds = new Set([
    ...body.unions.map((wire) => wire.id),
    ...body.unionEvents.flatMap((wire) =>
      "unionId" in wire ? [wire.unionId] : [],
    ),
    ...body.treeUnions.map((wire) => wire.unionId),
    ...cascadedReferences.unionIds,
  ])
  const parentIds = new Set([
    ...body.parentChildRelationships.map((wire) => wire.id),
    ...body.treeParentChildRelationships.map(
      (wire) => wire.parentChildRelationshipId,
    ),
    ...cascadedReferences.parentRelationshipIds,
  ])
  for (const alias of parentAliases.values()) parentIds.add(alias.id)

  if (deletedPersonIds.length > 0) {
    const [affectedUnions, affectedParents] = await Promise.all([
      db
        .select({ id: unions.id })
        .from(unions)
        .where(
          or(
            inArray(unions.firstPersonId, deletedPersonIds),
            inArray(unions.secondPersonId, deletedPersonIds),
          ),
        ),
      db
        .select({ id: parentChildRelationships.id })
        .from(parentChildRelationships)
        .where(
          or(
            inArray(parentChildRelationships.parentPersonId, deletedPersonIds),
            inArray(parentChildRelationships.childPersonId, deletedPersonIds),
          ),
        ),
    ])
    for (const row of affectedUnions) unionIds.add(row.id)
    for (const row of affectedParents) parentIds.add(row.id)
  }

  const personIdList = [...personIds]
  const unionIdList = [...unionIds]
  const parentIdList = [...parentIds]
  const changedTreeIds = [...new Set(body.trees.map((wire) => wire.id))]
  const [
    personRows,
    treeRows,
    memberRows,
    unionRows,
    eventRows,
    treeUnionRows,
    parentRows,
    treeParentRows,
  ] = await Promise.all([
    personIdList.length > 0
      ? db.select().from(persons).where(inArray(persons.id, personIdList))
      : [],
    changedTreeIds.length > 0
      ? db.select().from(trees).where(inArray(trees.id, changedTreeIds))
      : [],
    personIdList.length > 0
      ? db
          .select()
          .from(treeMembers)
          .where(inArray(treeMembers.personId, personIdList))
      : [],
    unionIdList.length > 0
      ? db.select().from(unions).where(inArray(unions.id, unionIdList))
      : [],
    unionIdList.length > 0
      ? db
          .select()
          .from(unionEvents)
          .where(inArray(unionEvents.unionId, unionIdList))
      : [],
    unionIdList.length > 0
      ? db
          .select()
          .from(treeUnions)
          .where(inArray(treeUnions.unionId, unionIdList))
      : [],
    parentIdList.length > 0
      ? db
          .select()
          .from(parentChildRelationships)
          .where(inArray(parentChildRelationships.id, parentIdList))
      : [],
    parentIdList.length > 0
      ? db
          .select()
          .from(treeParentChildRelationships)
          .where(
            inArray(
              treeParentChildRelationships.parentChildRelationshipId,
              parentIdList,
            ),
          )
      : [],
  ])

  const changesByTree = new Map<string, SyncRecordSet>()
  const peopleById = new Map(personRows.map((row) => [row.id, row]))
  const unionsById = new Map(unionRows.map((row) => [row.id, row]))
  const eventsByUnion = new Map<string, typeof eventRows>()
  for (const event of eventRows) {
    const events = eventsByUnion.get(event.unionId) ?? []
    events.push(event)
    eventsByUnion.set(event.unionId, events)
  }
  const parentsById = new Map(parentRows.map((row) => [row.id, row]))
  const recordsFor = (treeId: string): SyncRecordSet => {
    const existing = changesByTree.get(treeId)
    if (existing) return existing
    const created = emptyRecordSet()
    changesByTree.set(treeId, created)
    return created
  }
  for (const row of treeRows) recordsFor(row.id).trees.push(treeToWire(row))
  for (const row of memberRows) {
    const explicit = explicitMemberKeys.has(
      associationKey(row.treeId, row.personId),
    )
    if (row.deletedAt && !explicit && !deletedPersonIdSet.has(row.personId)) {
      continue
    }
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIdSet.has(row.personId)) {
      records.treeMembers.push(treeMemberToWire(row))
    }
    const person = peopleById.get(row.personId)
    if (
      person
      && (!row.deletedAt || deletedPersonIdSet.has(row.personId))
      && !records.persons.some((wire) => wire.id === person.id)
    ) {
      records.persons.push(personToWire(person))
    }
  }
  for (const row of treeUnionRows) {
    const explicit = explicitTreeUnionKeys.has(
      associationKey(row.treeId, row.unionId),
    )
    if (row.deletedAt && !explicit && deletedPersonIds.length === 0) continue
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIds.length > 0) {
      records.treeUnions.push(treeUnionToWire(row))
    }
    const union =
      !row.deletedAt || deletedPersonIds.length > 0
        ? unionsById.get(row.unionId)
        : undefined
    if (union && !records.unions.some((wire) => wire.id === union.id)) {
      records.unions.push(unionToWire(union))
      records.unionEvents.push(
        ...(eventsByUnion.get(union.id) ?? []).map(unionEventToWire),
      )
    }
  }
  for (const row of treeParentRows) {
    const explicit = explicitTreeParentKeys.has(
      associationKey(row.treeId, row.parentChildRelationshipId),
    )
    if (row.deletedAt && !explicit && deletedPersonIds.length === 0) continue
    const records = recordsFor(row.treeId)
    if (explicit || deletedPersonIds.length > 0) {
      records.treeParentChildRelationships.push(
        treeParentRelationshipToWire(row),
      )
    }
    const candidateRelationship = parentsById.get(row.parentChildRelationshipId)
    const relationship =
      !row.deletedAt
      || deletedPersonIds.length > 0
      || (explicit && Boolean(candidateRelationship?.deletedAt))
        ? candidateRelationship
        : undefined
    if (
      relationship
      && !records.parentChildRelationships.some(
        (wire) => wire.id === relationship.id,
      )
    ) {
      records.parentChildRelationships.push(
        parentRelationshipToWire(relationship),
      )
    }
  }
  return changesByTree
}

function validId(value: string): boolean {
  return isValidSyncId(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function isOptionalPhoto(value: unknown): boolean {
  return value === null || isOptionalString(value)
}

function isParentGraphConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && error.code === "23514") return true
  return "cause" in error && isParentGraphConstraintError(error.cause)
}

async function prepareMutationContext(
  db: DB,
  me: SessionUser,
  body: SyncPushRequest,
  mutationId: string | null,
  photoLifecycle: PhotoLifecycle,
): Promise<MutationContext | Response> {
  if (mutationId) {
    await db.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${me.id}:${mutationId}`}, 0)
      )
    `)
    const receipt = await db.query.mutationReceipts.findFirst({
      where: and(
        eq(mutationReceipts.userId, me.id),
        eq(mutationReceipts.mutationId, mutationId),
      ),
    })
    if (receipt) {
      return Response.json(
        {
          ...(receipt.response as SyncMutationResponse),
          status: "alreadyApplied",
        } satisfies SyncMutationResponse,
        { headers: { "cache-control": "private, no-store" } },
      )
    }
  }

  const quotaTreeIds = await lockMutationGraph(db, body)
  const usageBefore = await loadTreeUsage(db, quotaTreeIds)
  const treeRoleCache = new Map<string, Promise<Role | null>>()
  const personRoleCache = new Map<string, Promise<Role | null>>()
  const roleForTree: RoleForTree = async (treeId) => {
    const cached = treeRoleCache.get(treeId)
    if (cached) return cached
    const role = await treeRole(db, me.id, treeId)
    treeRoleCache.set(treeId, Promise.resolve(role))
    return role
  }
  const roleForPerson: RoleForPerson = async (personId) => {
    const cached = personRoleCache.get(personId)
    if (cached) return cached
    const role = await personRole(db, me.id, personId)
    personRoleCache.set(personId, Promise.resolve(role))
    return role
  }
  const activePersonCache = new Map<string, boolean>()
  const activePeopleExistForRequest: ActivePeopleExist = async (personIds) => {
    const uniqueIds = [...new Set(personIds)]
    if (uniqueIds.some((id) => !validId(id))) return false
    const unknownIds = uniqueIds.filter((id) => !activePersonCache.has(id))
    if (unknownIds.length > 0) {
      const rows = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(inArray(persons.id, unknownIds), isNull(persons.deletedAt)))
      const activeIds = new Set(rows.map((row) => row.id))
      for (const id of unknownIds) activePersonCache.set(id, activeIds.has(id))
    }
    return uniqueIds.every((id) => activePersonCache.get(id) === true)
  }
  const referencedTreeIds = [
    ...new Set([
      ...body.trees.map((wire) => wire.id),
      ...body.treeMembers.map((wire) => wire.treeId),
      ...body.treeUnions.map((wire) => wire.treeId),
      ...body.treeParentChildRelationships.map((wire) => wire.treeId),
    ]),
  ]
  if (referencedTreeIds.length > 0) {
    const roleRows = await db
      .select({
        treeId: trees.id,
        ownerId: trees.ownerId,
        deletedAt: trees.deletedAt,
      })
      .from(trees)
      .where(inArray(trees.id, referencedTreeIds))
    for (const row of roleRows) {
      if (!row.deletedAt && row.ownerId === me.id) {
        treeRoleCache.set(row.treeId, Promise.resolve("owner"))
      }
    }
  }
  const referencedPersonIds = [
    ...new Set([
      ...body.persons.map((wire) => wire.id),
      ...body.treeMembers.map((wire) => wire.personId),
      ...body.unions.flatMap((wire) =>
        "deletedAt" in wire ? [] : [wire.firstPersonId, wire.secondPersonId],
      ),
      ...body.parentChildRelationships.flatMap((wire) =>
        "deletedAt" in wire ? [] : [wire.parentPersonId, wire.childPersonId],
      ),
    ]),
  ]
  const ownedPersonIds = new Set<string>()
  if (referencedPersonIds.length > 0) {
    const personRows = await db
      .select({
        id: persons.id,
        ownerId: persons.ownerId,
        deletedAt: persons.deletedAt,
      })
      .from(persons)
      .where(inArray(persons.id, referencedPersonIds))
    for (const row of personRows) {
      if (!row.deletedAt && row.ownerId === me.id) {
        ownedPersonIds.add(row.id)
        personRoleCache.set(row.id, Promise.resolve("owner"))
      }
    }
  }
  return {
    db,
    me,
    body,
    mutationId,
    serverTime: new Date(),
    quotaTreeIds,
    usageBefore,
    roleForTree,
    roleForPerson,
    treeRoleCache,
    personRoleCache,
    activePeopleExistForRequest,
    ownedPersonIds,
    photoLifecycle,
  }
}

async function _finalizeMutation(
  context: MutationContext,
  state: MutationApplicationState,
  outcome: MutationOutcome,
  rollback: () => never,
): Promise<Response> {
  const { body, db, me, mutationId, quotaTreeIds, serverTime, usageBefore } =
    context
  const {
    applied,
    cascadedReferences,
    missingParentRelationshipIds,
    orphanCandidateRelationshipIds,
    parentAssociationAliases,
    parentRelationshipIdAlias,
    skipped,
  } = state
  await tombstoneOrphanParentRelationships(
    db,
    orphanCandidateRelationshipIds,
    serverTime,
  )

  const usageAfter = await loadTreeUsage(db, quotaTreeIds)
  let quotaViolation:
    | {
        treeId: string
        reason: "tree-member-limit" | "tree-related-record-limit"
        maximum: number
        current: number
      }
    | undefined
  for (const treeId of quotaTreeIds) {
    const before = usageBefore.get(treeId) ?? { members: 0, relatedRecords: 0 }
    const after = usageAfter.get(treeId) ?? before
    if (after.members > MAX_TREE_MEMBERS && after.members > before.members) {
      quotaViolation = {
        treeId,
        reason: "tree-member-limit",
        maximum: MAX_TREE_MEMBERS,
        current: after.members,
      }
      break
    }
    if (
      after.relatedRecords > MAX_TREE_RELATED_RECORDS
      && after.relatedRecords > before.relatedRecords
    ) {
      quotaViolation = {
        treeId,
        reason: "tree-related-record-limit",
        maximum: MAX_TREE_RELATED_RECORDS,
        current: after.relatedRecords,
      }
      break
    }
  }
  if (quotaViolation) {
    if (!mutationId) throw new Error("tree record limit exceeded")
    outcome.conflict = {
      mutationId,
      serverTime: serverTime.toISOString(),
      skipped: requestIds(body),
      retryable: false,
      reason: quotaViolation.reason,
      limit: {
        treeId: quotaViolation.treeId,
        maximum: quotaViolation.maximum,
        current: quotaViolation.current,
      },
    }
    rollback()
  }

  if (mutationId && !hasClassifiedRecords(skipped)) {
    const changesByTree = await collectMutationChanges(
      db,
      body,
      parentRelationshipIdAlias,
      cascadedReferences,
    )
    for (const [treeId, records] of [...changesByTree].sort(
      ([first], [second]) => first.localeCompare(second),
    )) {
      const versionRows = await db
        .update(trees)
        .set({ syncVersion: sql`${trees.syncVersion} + 1` })
        .where(eq(trees.id, treeId))
        .returning({ version: trees.syncVersion })
      const version = versionRows[0]?.version
      if (version === undefined) continue
      if (
        new TextEncoder().encode(JSON.stringify(records)).byteLength
        <= MAX_RESPONSE_PAGE_BYTES
      ) {
        await db.insert(syncChanges).values({
          treeId,
          version,
          mutationId,
          records,
        })
      }
    }
    const retentionCutoff = new Date(
      serverTime.getTime() - 30 * 24 * 60 * 60 * 1000,
    )
    await Promise.all([
      db.delete(syncChanges).where(lt(syncChanges.createdAt, retentionCutoff)),
      db
        .delete(mutationReceipts)
        .where(lt(mutationReceipts.createdAt, retentionCutoff)),
    ])
  }
  const response: SyncPushResponse = {
    applied,
    skipped,
    ...(parentRelationshipIdAlias.size > 0
      ? {
          aliases: {
            parentChildRelationships: Object.fromEntries(
              parentRelationshipIdAlias,
            ),
            ...(parentAssociationAliases.size > 0
              ? {
                  treeParentChildRelationships: Object.fromEntries(
                    parentAssociationAliases,
                  ),
                }
              : {}),
          },
        }
      : {}),
    serverTime: serverTime.toISOString(),
  }
  if (mutationId && hasClassifiedRecords(skipped)) {
    outcome.conflict = {
      mutationId,
      serverTime: response.serverTime,
      skipped: requestIds(body),
      retryable: true,
      reason:
        missingParentRelationshipIds.size > 0
          ? "missing-parent-relationship"
          : "revision-mismatch",
      ...(missingParentRelationshipIds.size > 0
        ? {
            missingDependencies: {
              parentChildRelationships: [...missingParentRelationshipIds],
            },
          }
        : {}),
    }
    rollback()
  }
  const responseBody: SyncPushResponse | SyncMutationResponse = mutationId
    ? { ...response, mutationId, status: "applied" }
    : response
  if (mutationId) {
    await db.insert(mutationReceipts).values({
      userId: me.id,
      mutationId,
      response: responseBody,
    })
  }
  return Response.json(responseBody, {
    headers: { "cache-control": "private, no-store" },
  })
}

/** POST /api/sync — normalized CRUD with per-record ACL and conditional LWW. */
export async function postSync(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const parsed = await readJsonBody(request, MAX_SYNC_BODY_BYTES)
  if (!parsed.ok) {
    if (parsed.error === "too-large") {
      return Response.json({ error: "sync payload too large" }, { status: 413 })
    }
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  const parsedBody = parsed.value
  const validationTime = new Date()
  if (!isValidSyncPushRequest(parsedBody, validationTime)) {
    return Response.json({ error: "invalid sync payload" }, { status: 400 })
  }

  const mutationIdHeader = request.headers.get("x-sync-mutation-id")
  const mutationId = isValidMutationId(mutationIdHeader)
    ? mutationIdHeader
    : null
  if (mutationIdHeader && !mutationId) {
    return Response.json({ error: "invalid mutation id" }, { status: 400 })
  }
  return runSyncMutation(me, parsedBody, mutationId)
}

/**
 * Core normalized-CRD sync mutation, separated from the HTTP/auth adapter so
 * the full pipeline (idempotency, ACL, graph constraints, writes, change log,
 * photo lifecycle) is testable without forging an OAuth session. `me` is the
 * authenticated user and `body` is already validated by the caller.
 */
export async function runSyncMutation(
  me: SessionUser,
  body: SyncPushRequest,
  mutationId: string | null,
): Promise<Response> {
  const rootDb = getDB()
  const outcome: MutationOutcome = {}
  let committedResponse: Response | undefined
  let photoLifecycle: PhotoLifecycle | undefined

  try {
    // Stage 1: upload data URLs before acquiring the transaction connection.
    photoLifecycle = await preuploadMutationPhotos(me, body)
    const stagedPhotoLifecycle = photoLifecycle

    const transactionResponse = await rootDb.transaction(
      async (transaction) => {
        // Stage 2: serialize idempotency and graph changes, then hydrate ACL state.
        const prepared = await prepareMutationContext(
          transaction,
          me,
          body,
          mutationId,
          stagedPhotoLifecycle,
        )
        if (prepared instanceof Response) return prepared
        const {
          activePeopleExistForRequest,
          db,
          ownedPersonIds,
          personRoleCache,
          quotaTreeIds,
          roleForPerson,
          roleForTree,
          serverTime,
          treeRoleCache,
          usageBefore,
        } = prepared
        const state = createMutationApplicationState()
        const {
          applied,
          cascadedReferences,
          missingParentRelationshipIds,
          orphanCandidateRelationshipIds,
          parentAssociationAliases,
          parentRelationshipIdAlias,
          skipped,
        } = state
        const ownedPersonDeleteIds = new Set(
          body.persons
            .filter(
              (wire) => "deletedAt" in wire && ownedPersonIds.has(wire.id),
            )
            .map((wire) => wire.id),
        )
        const cascadeUnionIds = new Set<string>()
        const cascadeParentIds = new Set<string>()
        if (ownedPersonDeleteIds.size > 0) {
          const ids = [...ownedPersonDeleteIds]
          const [affectedUnions, affectedParents] = await Promise.all([
            db
              .select({ id: unions.id })
              .from(unions)
              .where(
                or(
                  inArray(unions.firstPersonId, ids),
                  inArray(unions.secondPersonId, ids),
                ),
              ),
            db
              .select({ id: parentChildRelationships.id })
              .from(parentChildRelationships)
              .where(
                or(
                  inArray(parentChildRelationships.parentPersonId, ids),
                  inArray(parentChildRelationships.childPersonId, ids),
                ),
              ),
          ])
          for (const row of affectedUnions) cascadeUnionIds.add(row.id)
          for (const row of affectedParents) cascadeParentIds.add(row.id)
        }

        // Stage 3: apply removals and upserts in the established dependency order.
        const forbiddenGlobalDeletes = [
          ["unions", body.unions],
          ["unionEvents", body.unionEvents],
          ["parentChildRelationships", body.parentChildRelationships],
        ] as const
        for (const [collection, wires] of forbiddenGlobalDeletes) {
          if (clientCanTombstone(collection)) continue
          for (const wire of wires) {
            if ("deletedAt" in wire) {
              classify(applied, skipped, collection, wire.id, false)
            }
          }
        }

        // Remove tree-scoped relationship associations before memberships.
        for (const wire of body.treeUnions) {
          if (!("deletedAt" in wire)) continue
          const key = associationKey(wire.treeId, wire.unionId)
          if (cascadeUnionIds.has(wire.unionId)) {
            classify(applied, skipped, "treeUnions", key, true)
            continue
          }
          const updatedAt = wireTimestamp(wire)
          const revision = wireRevision(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.unionId)
            || !updatedAt
            || !revision
            || !canWrite(await roleForTree(wire.treeId))
          ) {
            classify(applied, skipped, "treeUnions", key, false)
            continue
          }
          const rows = await db
            .update(treeUnions)
            .set({
              deletedAt: serverTime,
              updatedAt: serverTime,
              revision: sql`${treeUnions.revision} + 1`,
            })
            .where(
              and(
                eq(treeUnions.treeId, wire.treeId),
                eq(treeUnions.unionId, wire.unionId),
                eq(treeUnions.revision, revision),
              ),
            )
            .returning({ treeId: treeUnions.treeId })
          classify(applied, skipped, "treeUnions", key, rows.length > 0)
        }
        for (const wire of body.treeParentChildRelationships) {
          if (!("deletedAt" in wire)) continue
          const key = associationKey(
            wire.treeId,
            wire.parentChildRelationshipId,
          )
          if (cascadeParentIds.has(wire.parentChildRelationshipId)) {
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              true,
            )
            continue
          }
          const updatedAt = wireTimestamp(wire)
          const revision = wireRevision(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.parentChildRelationshipId)
            || !updatedAt
            || !revision
            || !canWrite(await roleForTree(wire.treeId))
          ) {
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              false,
            )
            continue
          }
          const rows = await db
            .update(treeParentChildRelationships)
            .set({
              deletedAt: serverTime,
              updatedAt: serverTime,
              revision: sql`${treeParentChildRelationships.revision} + 1`,
            })
            .where(
              and(
                eq(treeParentChildRelationships.treeId, wire.treeId),
                eq(
                  treeParentChildRelationships.parentChildRelationshipId,
                  wire.parentChildRelationshipId,
                ),
                eq(treeParentChildRelationships.revision, revision),
              ),
            )
            .returning({ treeId: treeParentChildRelationships.treeId })
          if (rows.length > 0) {
            orphanCandidateRelationshipIds.add(wire.parentChildRelationshipId)
          }
          classify(
            applied,
            skipped,
            "treeParentChildRelationships",
            key,
            rows.length > 0,
          )
        }

        // Validate removals up front so their reference tombstoning can be batched
        // into a fixed number of queries instead of four per removal. Reference
        // tombstoning is unconditional for any validated removal (it ran before
        // the per-wire revision-guarded delete in the previous per-wire loop, so
        // it must still run even when a member row's revision later mismatches).
        const memberRemovals: {
          treeId: string
          personId: string
          revision: number
          key: string
        }[] = []
        for (const wire of body.treeMembers) {
          if (!("deletedAt" in wire)) continue
          const key = associationKey(wire.treeId, wire.personId)
          if (ownedPersonDeleteIds.has(wire.personId)) {
            classify(applied, skipped, "treeMembers", key, true)
            continue
          }
          const updatedAt = wireTimestamp(wire)
          const revision = wireRevision(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.personId)
            || !updatedAt
            || !revision
            || !canWrite(await roleForTree(wire.treeId))
          ) {
            classify(applied, skipped, "treeMembers", key, false)
            continue
          }
          memberRemovals.push({
            treeId: wire.treeId,
            personId: wire.personId,
            revision,
            key,
          })
        }

        if (memberRemovals.length > 0) {
          const { unionAssociations, parentAssociations } =
            await tombstonePersonReferencesInTrees(
              db,
              memberRemovals.map((removal) => ({
                treeId: removal.treeId,
                personId: removal.personId,
              })),
              serverTime,
            )
          for (const { treeId, unionId } of unionAssociations) {
            cascadedReferences.unionIds.add(unionId)
            cascadedReferences.treeUnionKeys.add(
              associationKey(treeId, unionId),
            )
          }
          for (const {
            treeId,
            parentChildRelationshipId,
          } of parentAssociations) {
            orphanCandidateRelationshipIds.add(parentChildRelationshipId)
            cascadedReferences.parentRelationshipIds.add(
              parentChildRelationshipId,
            )
            cascadedReferences.treeParentRelationshipKeys.add(
              associationKey(treeId, parentChildRelationshipId),
            )
          }
        }

        for (const removal of memberRemovals) {
          const rows = await db
            .update(treeMembers)
            .set({
              deletedAt: serverTime,
              updatedAt: serverTime,
              revision: sql`${treeMembers.revision} + 1`,
            })
            .where(
              and(
                eq(treeMembers.treeId, removal.treeId),
                eq(treeMembers.personId, removal.personId),
                eq(treeMembers.revision, removal.revision),
              ),
            )
            .returning({ treeId: treeMembers.treeId })
          if (rows.length > 0) personRoleCache.delete(removal.personId)
          classify(
            applied,
            skipped,
            "treeMembers",
            removal.key,
            rows.length > 0,
          )
        }

        for (const wire of body.persons) {
          if (!("deletedAt" in wire)) continue
          const updatedAt = wireTimestamp(wire)
          const revision = wireRevision(wire)
          if (!updatedAt || !revision) {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          const wasDeleted = await tombstonePersonCascade(
            db,
            me.id,
            wire.id,
            revision,
            serverTime,
            stagedPhotoLifecycle.photosToDeleteAfterCommit,
          )
          if (wasDeleted) personRoleCache.set(wire.id, Promise.resolve(null))
          classify(applied, skipped, "persons", wire.id, wasDeleted)
        }

        for (const wire of body.trees) {
          if (!("deletedAt" in wire)) continue
          const updatedAt = wireTimestamp(wire)
          const revision = wireRevision(wire)
          if (!updatedAt || !revision) {
            classify(applied, skipped, "trees", wire.id, false)
            continue
          }
          const effects = await tombstoneOwnedTree(db, {
            ownerId: me.id,
            treeId: wire.id,
            expectedRevision: revision,
            serverTime,
          })
          if (effects) {
            for (const id of effects.parentRelationshipIds) {
              orphanCandidateRelationshipIds.add(id)
            }
            treeRoleCache.set(wire.id, Promise.resolve(null))
            personRoleCache.clear()
          }
          classify(applied, skipped, "trees", wire.id, !!effects)
        }

        // Upserts run in foreign-key order: roots, memberships, global facts, links.
        // Batch tree existence lookups into one query instead of one round-trip per
        // tree. Trees never depend on each other within a mutation, so a single
        // inArray fetch is equivalent to N findFirsts.
        const upsertTreeIds = [
          ...new Set(
            body.trees
              .filter((wire) => !("deletedAt" in wire) && validId(wire.id))
              .map((wire) => wire.id),
          ),
        ]
        const treeRows = upsertTreeIds.length
          ? await db.query.trees.findMany({
              where: inArray(trees.id, upsertTreeIds),
            })
          : []
        const existingTrees = new Map(
          treeRows.map((row) => [row.id, row] as const),
        )

        for (const wire of body.trees) {
          if ("deletedAt" in wire) continue
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.id)
            || typeof wire.name !== "string"
            || !updatedAt
            || !createdAt
          ) {
            classify(applied, skipped, "trees", wire.id, false)
            continue
          }
          const existing = existingTrees.get(wire.id)
          if (!existing) {
            const rows = await db
              .insert(trees)
              .values({
                id: wire.id,
                ownerId: me.id,
                name: wire.name,
                createdAt,
                updatedAt: serverTime,
              })
              .onConflictDoNothing()
              .returning({ id: trees.id })
            if (rows.length > 0) {
              treeRoleCache.set(wire.id, Promise.resolve("owner"))
            }
            classify(applied, skipped, "trees", wire.id, rows.length > 0)
            continue
          }
          if (existing.ownerId !== me.id || existing.deletedAt) {
            classify(applied, skipped, "trees", wire.id, false)
            continue
          }
          const rows = await db
            .update(trees)
            .set({
              name: wire.name,
              updatedAt: serverTime,
              revision: sql`${trees.revision} + 1`,
            })
            .where(
              and(
                eq(trees.id, wire.id),
                eq(trees.ownerId, me.id),
                isNull(trees.deletedAt),
                eq(trees.revision, wire.revision ?? 0),
              ),
            )
            .returning({ id: trees.id })
          if (rows.length > 0) {
            treeRoleCache.set(wire.id, Promise.resolve("owner"))
          }
          classify(applied, skipped, "trees", wire.id, rows.length > 0)
        }

        // Batch the per-person existence lookup into one query instead of one
        // round-trip per person. Persons never depend on each other within a
        // mutation, so a single inArray fetch is equivalent to N findFirsts.
        const upsertPersonIds = [
          ...new Set(
            body.persons
              .filter((wire) => !("deletedAt" in wire) && validId(wire.id))
              .map((wire) => wire.id),
          ),
        ]
        const personRows = upsertPersonIds.length
          ? await db.query.persons.findMany({
              where: inArray(persons.id, upsertPersonIds),
            })
          : []
        const existingPersons = new Map(
          personRows.map((row) => [row.id, row] as const),
        )

        for (const wire of body.persons) {
          if ("deletedAt" in wire) continue
          const updatedAt = wireTimestamp(wire)
          if (
            !validId(wire.id)
            || typeof wire.name !== "string"
            || !isOptionalString(wire.dob)
            || !isOptionalString(wire.dod)
            || (wire.gender !== undefined && !GENDERS.has(wire.gender))
            || !isOptionalString(wire.familyName)
            || !isOptionalString(wire.birthplace)
            || !isOptionalPhoto(wire.photo)
            || !updatedAt
          ) {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          const existing = existingPersons.get(wire.id)
          if (!existing) {
            if (wire.photo && !isPhotoDataUrl(wire.photo)) {
              classify(applied, skipped, "persons", wire.id, false)
              continue
            }
            let photo: string | null
            try {
              photo = resolvePreuploadedPhoto(stagedPhotoLifecycle, wire.photo)
            } catch {
              classify(applied, skipped, "persons", wire.id, false)
              continue
            }
            const rows = await db
              .insert(persons)
              .values({
                id: wire.id,
                ownerId: me.id,
                name: wire.name,
                dob: wire.dob ?? null,
                dod: wire.dod ?? null,
                gender: wire.gender ?? null,
                familyName: wire.familyName ?? "",
                birthplace: wire.birthplace ?? null,
                photo,
                updatedAt: serverTime,
              })
              .onConflictDoNothing()
              .returning({ id: persons.id })
            if (rows.length === 0 && photo) await deletePhoto(photo)
            if (rows.length > 0) {
              if (photo) stagedPhotoLifecycle.consumedPhotos.add(photo)
              personRoleCache.set(wire.id, Promise.resolve("owner"))
            }
            classify(applied, skipped, "persons", wire.id, rows.length > 0)
            continue
          }
          const forced = wire.force === true
          if (
            existing.deletedAt
            || (!forced && existing.revision !== wire.revision)
            || !canWrite(await roleForPerson(wire.id))
            || (wire.photo !== undefined
              && wire.photo !== null
              && !isPhotoDataUrl(wire.photo)
              && wire.photo !== existing.photo)
          ) {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          let photo: string | null
          try {
            photo = resolvePreuploadedPhotoUpdate(
              stagedPhotoLifecycle,
              existing.photo,
              wire.photo,
            )
          } catch {
            classify(applied, skipped, "persons", wire.id, false)
            continue
          }
          const result = await db.execute(
            sql<{ id: string; previousPhoto: string | null }>`
        WITH target_person AS MATERIALIZED (
          SELECT ${persons.id} AS id, ${persons.photo} AS photo
          FROM ${persons}
          WHERE ${persons.id} = ${wire.id}
            AND ${persons.deletedAt} IS NULL
            AND ${forced ? sql`TRUE` : sql`${persons.revision} = ${wire.revision ?? 0}`}
          FOR UPDATE
        ),
        updated_person AS (
          UPDATE ${persons}
          SET "name" = ${wire.name},
              "dob" = ${wire.dob ?? null},
              "dod" = ${wire.dod ?? null},
              "gender" = ${wire.gender ?? null},
              "family_name" = ${wire.familyName ?? ""},
              "birthplace" = ${wire.birthplace ?? null},
              "photo" = ${photo},
              "updated_at" = ${serverTime},
              "revision" = "revision" + 1
          WHERE ${persons.id} IN (SELECT id FROM target_person)
          RETURNING ${persons.id} AS id
        )
        SELECT updated_person.id AS id,
               target_person.photo AS "previousPhoto"
        FROM updated_person
        INNER JOIN target_person ON target_person.id = updated_person.id
      `,
          )
          const updated = result.rows.length > 0
          if (!updated && photo && isPhotoDataUrl(wire.photo)) {
            await deletePhoto(photo)
          }
          const previousPhoto = result.rows[0]?.previousPhoto as
            | string
            | null
            | undefined
          if (
            previousPhoto
            && photo !== previousPhoto
            && !isPhotoDataUrl(previousPhoto)
          ) {
            stagedPhotoLifecycle.photosToDeleteAfterCommit.add(previousPhoto)
          }
          if (
            updated
            && photo
            && photo !== previousPhoto
            && !isPhotoDataUrl(photo)
          ) {
            stagedPhotoLifecycle.consumedPhotos.add(photo)
          }
          classify(applied, skipped, "persons", wire.id, updated)
        }

        await activePeopleExistForRequest([
          ...body.treeMembers.flatMap((wire) =>
            "deletedAt" in wire ? [] : [wire.personId],
          ),
          ...body.unions.flatMap((wire) =>
            "deletedAt" in wire
              ? []
              : [wire.firstPersonId, wire.secondPersonId],
          ),
          ...body.parentChildRelationships.flatMap((wire) =>
            "deletedAt" in wire
              ? []
              : [wire.parentPersonId, wire.childPersonId],
          ),
        ])

        // Batch tree-member existence lookups. Membership is keyed by the composite
        // (treeId, personId), so fetch every membership for the trees this mutation
        // references in one query and index by association key. Equivalent to N
        // findFirsts; entries include soft-deleted rows so the deletedAt checks are
        // preserved.
        const memberTreeIds = [
          ...new Set(
            body.treeMembers
              .filter((wire) => !("deletedAt" in wire) && validId(wire.treeId))
              .map((wire) => wire.treeId),
          ),
        ]
        const memberRows = memberTreeIds.length
          ? await db.query.treeMembers.findMany({
              where: inArray(treeMembers.treeId, memberTreeIds),
            })
          : []
        const existingTreeMembers = new Map(
          memberRows.map(
            (row) => [associationKey(row.treeId, row.personId), row] as const,
          ),
        )

        for (const wire of body.treeMembers) {
          if ("deletedAt" in wire) continue
          const key = associationKey(wire.treeId, wire.personId)
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.personId)
            || !updatedAt
            || !createdAt
            || !canWrite(await roleForTree(wire.treeId))
            || !(await activePeopleExistForRequest([wire.personId]))
          ) {
            classify(applied, skipped, "treeMembers", key, false)
            continue
          }
          const existing = existingTreeMembers.get(key)
          if (
            (!existing || existing.deletedAt)
            && !canWrite(await roleForPerson(wire.personId))
          ) {
            classify(applied, skipped, "treeMembers", key, false)
            continue
          }
          const rows = await db
            .insert(treeMembers)
            .values({
              treeId: wire.treeId,
              personId: wire.personId,
              createdAt,
              updatedAt: serverTime,
            })
            .onConflictDoUpdate({
              target: [treeMembers.treeId, treeMembers.personId],
              set: {
                deletedAt: null,
                updatedAt: serverTime,
                revision: sql`${treeMembers.revision} + 1`,
              },
              setWhere: eq(treeMembers.revision, wire.revision ?? 0),
            })
            .returning({ treeId: treeMembers.treeId })
          if (rows.length > 0) personRoleCache.delete(wire.personId)
          classify(applied, skipped, "treeMembers", key, rows.length > 0)
        }

        const createdUnionIds = new Set<string>()
        // Batch union existence lookups: the unions loop, unionEvents loop, and
        // treeUnions loop all resolve a union by id. Pre-fetch every referenced
        // union in one query and keep the map current as the unions loop inserts
        // new ones, so the dependent loops never re-query. Entries include
        // soft-deleted rows; callers that need only active unions check deletedAt.
        const referencedUnionIds = [
          ...new Set(
            [
              ...body.unions
                .filter((wire) => !("deletedAt" in wire))
                .map((wire) => wire.id),
              ...body.unionEvents.flatMap((wire) =>
                "deletedAt" in wire ? [] : [wire.unionId],
              ),
              ...body.treeUnions
                .filter((wire) => !("deletedAt" in wire))
                .map((wire) => wire.unionId),
            ].filter((id) => validId(id)),
          ),
        ]
        const unionRows = referencedUnionIds.length
          ? await db.query.unions.findMany({
              where: inArray(unions.id, referencedUnionIds),
            })
          : []
        const existingUnions = new Map(
          unionRows.map((row) => [row.id, row] as const),
        )

        for (const wire of body.unions) {
          if ("deletedAt" in wire) continue
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.id)
            || !validId(wire.firstPersonId)
            || !validId(wire.secondPersonId)
            || !isCanonicalUnion(wire.firstPersonId, wire.secondPersonId)
            || !updatedAt
            || !createdAt
            || !(await activePeopleExistForRequest([
              wire.firstPersonId,
              wire.secondPersonId,
            ]))
          ) {
            classify(applied, skipped, "unions", wire.id, false)
            continue
          }
          const existing = existingUnions.get(wire.id)
          if (!existing) {
            if (
              !(await hasWritableTreeContaining(
                db,
                [wire.firstPersonId, wire.secondPersonId],
                roleForTree,
              ))
            ) {
              classify(applied, skipped, "unions", wire.id, false)
              continue
            }
            const rows = await db
              .insert(unions)
              .values({
                id: wire.id,
                firstPersonId: wire.firstPersonId,
                secondPersonId: wire.secondPersonId,
                createdAt,
                updatedAt: serverTime,
              })
              .onConflictDoNothing()
              .returning({ id: unions.id })
            if (rows.length > 0) {
              createdUnionIds.add(wire.id)
              // Record the new union so the unionEvents/treeUnions loops resolve
              // it from the map instead of re-querying the database.
              existingUnions.set(wire.id, {
                id: wire.id,
                firstPersonId: wire.firstPersonId,
                secondPersonId: wire.secondPersonId,
                createdAt,
                updatedAt: serverTime,
                revision: 1,
                deletedAt: null,
              })
            }
            classify(applied, skipped, "unions", wire.id, rows.length > 0)
            continue
          }
          if (
            existing.deletedAt
            || existing.firstPersonId !== wire.firstPersonId
            || existing.secondPersonId !== wire.secondPersonId
            || !(await canWriteExistingUnion(db, me.id, existing, roleForTree))
          ) {
            classify(applied, skipped, "unions", wire.id, false)
            continue
          }
          const rows = await db
            .update(unions)
            .set({
              updatedAt: serverTime,
              revision: sql`${unions.revision} + 1`,
            })
            .where(
              and(
                eq(unions.id, wire.id),
                eq(unions.firstPersonId, wire.firstPersonId),
                eq(unions.secondPersonId, wire.secondPersonId),
                isNull(unions.deletedAt),
                eq(unions.revision, wire.revision ?? 0),
              ),
            )
            .returning({ id: unions.id })
          classify(applied, skipped, "unions", wire.id, rows.length > 0)
        }

        const createdParentRelationshipIds = new Set<string>()
        // Client-generated relationship ids that collided with a pre-existing active
        // canonical row for the same (parent, child) pair, mapped to that canonical
        // id so downstream association wires attach to the canonical relationship.
        // Canonical relationship ids adopted (not created) in this push. Treated like
        // created ids for association ACL gating, but excluded from orphan cleanup so
        // a pre-existing canonical row is never deleted as a side effect.
        const adoptedParentRelationshipIds = new Set<string>()
        // Batch parent-relationship existence lookups across the
        // parentChildRelationships loop and the treeParentChildRelationships loop.
        // Newly inserted relationships are added to the map so the association
        // loop resolves them without another query. Entries include soft-deleted
        // rows; callers that need only active relationships check deletedAt.
        const referencedParentRelationshipIds = [
          ...new Set(
            [
              ...body.parentChildRelationships
                .filter((wire) => !("deletedAt" in wire))
                .map((wire) => wire.id),
              ...body.treeParentChildRelationships
                .filter((wire) => !("deletedAt" in wire))
                .map((wire) => wire.parentChildRelationshipId),
            ].filter((id) => validId(id)),
          ),
        ]
        const parentRelationshipRows = referencedParentRelationshipIds.length
          ? await db.query.parentChildRelationships.findMany({
              where: inArray(
                parentChildRelationships.id,
                referencedParentRelationshipIds,
              ),
            })
          : []
        const existingParentRelationships = new Map(
          parentRelationshipRows.map((row) => [row.id, row] as const),
        )

        for (const wire of body.parentChildRelationships) {
          if ("deletedAt" in wire) continue
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.id)
            || !validId(wire.parentPersonId)
            || !validId(wire.childPersonId)
            || wire.parentPersonId === wire.childPersonId
            || !PARENT_RELATIONSHIP_TYPES.has(wire.type)
            || !updatedAt
            || !createdAt
            || !(await activePeopleExistForRequest([
              wire.parentPersonId,
              wire.childPersonId,
            ]))
          ) {
            classify(
              applied,
              skipped,
              "parentChildRelationships",
              wire.id,
              false,
            )
            continue
          }
          const existing = existingParentRelationships.get(wire.id)
          if (!existing) {
            if (
              !(await hasWritableTreeContaining(
                db,
                [wire.parentPersonId, wire.childPersonId],
                roleForTree,
              ))
            ) {
              classify(
                applied,
                skipped,
                "parentChildRelationships",
                wire.id,
                false,
              )
              continue
            }
            let inserted = false
            try {
              await db.transaction(async (tx) => {
                const rows = await tx
                  .insert(parentChildRelationships)
                  .values({
                    id: wire.id,
                    parentPersonId: wire.parentPersonId,
                    childPersonId: wire.childPersonId,
                    type: wire.type,
                    createdAt,
                    updatedAt: serverTime,
                  })
                  .onConflictDoNothing()
                  .returning({ id: parentChildRelationships.id })
                inserted = rows.length > 0
              })
            } catch (error) {
              if (!isParentGraphConstraintError(error)) throw error
            }
            if (inserted) {
              createdParentRelationshipIds.add(wire.id)
              // Record the new relationship so the treeParentChildRelationships
              // loop resolves it from the map instead of re-querying.
              existingParentRelationships.set(wire.id, {
                id: wire.id,
                parentPersonId: wire.parentPersonId,
                childPersonId: wire.childPersonId,
                type: wire.type,
                createdAt,
                updatedAt: serverTime,
                revision: 1,
                deletedAt: null,
              })
            } else {
              // The insert was dropped by a conflict on the active (parent, child)
              // partial unique index: a canonical active row for this pair already
              // exists under a different id (typically an orphan left behind by a
              // prior remove-parent). Adopt that canonical row so the link can
              // attach and the orphan gets re-associated, rather than reporting the
              // wire as skipped (which would wipe the optimistic link).
              const canonical =
                await db.query.parentChildRelationships.findFirst({
                  where: and(
                    eq(
                      parentChildRelationships.parentPersonId,
                      wire.parentPersonId,
                    ),
                    eq(
                      parentChildRelationships.childPersonId,
                      wire.childPersonId,
                    ),
                    isNull(parentChildRelationships.deletedAt),
                  ),
                })
              if (canonical) {
                // A client that did not know this canonical row has no base
                // revision with which to change its global type. Re-associate the
                // existing fact and preserve its authoritative type.
                parentRelationshipIdAlias.set(wire.id, {
                  id: canonical.id,
                  revision: canonical.revision,
                  type: canonical.type as ParentChildRelationshipType,
                })
                adoptedParentRelationshipIds.add(canonical.id)
                inserted = true
              }
            }
            classify(
              applied,
              skipped,
              "parentChildRelationships",
              wire.id,
              inserted,
            )
            continue
          }
          if (
            existing.deletedAt
            || existing.parentPersonId !== wire.parentPersonId
            || existing.childPersonId !== wire.childPersonId
            || !(await canWriteExistingParentRelationship(
              db,
              me.id,
              existing,
              roleForTree,
            ))
          ) {
            classify(
              applied,
              skipped,
              "parentChildRelationships",
              wire.id,
              false,
            )
            continue
          }
          const rows = await db
            .update(parentChildRelationships)
            .set({
              type: wire.type,
              updatedAt: serverTime,
              revision: sql`${parentChildRelationships.revision} + 1`,
            })
            .where(
              and(
                eq(parentChildRelationships.id, wire.id),
                eq(
                  parentChildRelationships.parentPersonId,
                  wire.parentPersonId,
                ),
                eq(parentChildRelationships.childPersonId, wire.childPersonId),
                isNull(parentChildRelationships.deletedAt),
                eq(parentChildRelationships.revision, wire.revision ?? 0),
              ),
            )
            .returning({ id: parentChildRelationships.id })
          classify(
            applied,
            skipped,
            "parentChildRelationships",
            wire.id,
            rows.length > 0,
          )
        }

        // Batch union-event existence lookups into one query instead of one
        // round-trip per event. Events are keyed by a single id, so a single
        // inArray fetch is equivalent to N findFirsts.
        const upsertUnionEventIds = [
          ...new Set(
            body.unionEvents
              .filter((wire) => !("deletedAt" in wire) && validId(wire.id))
              .map((wire) => wire.id),
          ),
        ]
        const unionEventRows = upsertUnionEventIds.length
          ? await db.query.unionEvents.findMany({
              where: inArray(unionEvents.id, upsertUnionEventIds),
            })
          : []
        const existingUnionEvents = new Map(
          unionEventRows.map((row) => [row.id, row] as const),
        )

        for (const wire of body.unionEvents) {
          if ("deletedAt" in wire) continue
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.id)
            || !validId(wire.unionId)
            || !UNION_EVENT_TYPES.has(wire.type)
            || (wire.eventDate !== undefined && !isValidIsoDate(wire.eventDate))
            || !updatedAt
            || !createdAt
          ) {
            classify(applied, skipped, "unionEvents", wire.id, false)
            continue
          }
          const union = existingUnions.get(wire.unionId)
          if (!union || union.deletedAt) {
            classify(applied, skipped, "unionEvents", wire.id, false)
            continue
          }
          const existing = existingUnionEvents.get(wire.id)
          if (!existing) {
            if (
              !createdUnionIds.has(union.id)
              && !(await canWriteExistingUnion(db, me.id, union, roleForTree))
            ) {
              classify(applied, skipped, "unionEvents", wire.id, false)
              continue
            }
            const rows = await db
              .insert(unionEvents)
              .values({
                id: wire.id,
                unionId: wire.unionId,
                type: wire.type,
                eventDate: wire.eventDate ?? null,
                createdAt,
                updatedAt: serverTime,
              })
              .onConflictDoNothing()
              .returning({ id: unionEvents.id })
            classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
            continue
          }
          if (
            existing.deletedAt
            || existing.unionId !== wire.unionId
            || !(await canWriteExistingUnion(db, me.id, union, roleForTree))
          ) {
            classify(applied, skipped, "unionEvents", wire.id, false)
            continue
          }
          const rows = await db
            .update(unionEvents)
            .set({
              type: wire.type,
              eventDate: wire.eventDate ?? null,
              updatedAt: serverTime,
              revision: sql`${unionEvents.revision} + 1`,
            })
            .where(
              and(
                eq(unionEvents.id, wire.id),
                eq(unionEvents.unionId, wire.unionId),
                isNull(unionEvents.deletedAt),
                eq(unionEvents.revision, wire.revision ?? 0),
              ),
            )
            .returning({ id: unionEvents.id })
          classify(applied, skipped, "unionEvents", wire.id, rows.length > 0)
        }

        // Batch tree-union existence lookups. Like memberships, tree-union rows are
        // keyed by a composite (treeId, unionId), so fetch every association for
        // the referenced trees in one query and index by association key.
        const unionTreeIds = [
          ...new Set(
            body.treeUnions
              .filter((wire) => !("deletedAt" in wire) && validId(wire.treeId))
              .map((wire) => wire.treeId),
          ),
        ]
        const treeUnionRows = unionTreeIds.length
          ? await db.query.treeUnions.findMany({
              where: inArray(treeUnions.treeId, unionTreeIds),
            })
          : []
        const existingTreeUnions = new Map(
          treeUnionRows.map(
            (row) => [associationKey(row.treeId, row.unionId), row] as const,
          ),
        )

        for (const wire of body.treeUnions) {
          if ("deletedAt" in wire) continue
          const key = associationKey(wire.treeId, wire.unionId)
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.unionId)
            || !updatedAt
            || !createdAt
            || !canWrite(await roleForTree(wire.treeId))
          ) {
            classify(applied, skipped, "treeUnions", key, false)
            continue
          }
          const union = existingUnions.get(wire.unionId)
          if (
            !union
            || union.deletedAt
            || !(await activeTreeHasMembers(
              db,
              wire.treeId,
              [union.firstPersonId, union.secondPersonId],
              activePeopleExistForRequest,
            ))
          ) {
            classify(applied, skipped, "treeUnions", key, false)
            continue
          }
          const existing = existingTreeUnions.get(key)
          if (
            !existing
            && !createdUnionIds.has(union.id)
            && !(await canWriteExistingUnion(db, me.id, union, roleForTree))
          ) {
            classify(applied, skipped, "treeUnions", key, false)
            continue
          }
          const rows = await db
            .insert(treeUnions)
            .values({
              treeId: wire.treeId,
              unionId: wire.unionId,
              createdAt,
              updatedAt: serverTime,
            })
            .onConflictDoUpdate({
              target: [treeUnions.treeId, treeUnions.unionId],
              set: {
                deletedAt: null,
                updatedAt: serverTime,
                revision: sql`${treeUnions.revision} + 1`,
              },
              setWhere: eq(treeUnions.revision, wire.revision ?? 0),
            })
            .returning({ treeId: treeUnions.treeId })
          classify(applied, skipped, "treeUnions", key, rows.length > 0)
        }

        // Batch tree-parent-relationship existence lookups. Like the other tree
        // associations these rows are keyed by a composite (treeId,
        // parentChildRelationshipId), so fetch every association for the referenced
        // trees in one query and index by association key.
        const parentRelTreeIds = [
          ...new Set(
            body.treeParentChildRelationships
              .filter((wire) => !("deletedAt" in wire) && validId(wire.treeId))
              .map((wire) => wire.treeId),
          ),
        ]
        const treeParentRows = parentRelTreeIds.length
          ? await db.query.treeParentChildRelationships.findMany({
              where: inArray(
                treeParentChildRelationships.treeId,
                parentRelTreeIds,
              ),
            })
          : []
        const existingTreeParentRelationships = new Map(
          treeParentRows.map(
            (row) =>
              [
                associationKey(row.treeId, row.parentChildRelationshipId),
                row,
              ] as const,
          ),
        )

        for (const wire of body.treeParentChildRelationships) {
          if ("deletedAt" in wire) continue
          // The client may have generated a fresh relationship id that collided with
          // a pre-existing canonical row; resolve to that canonical id so the
          // association attaches to the real relationship. The dirty key reported
          // back to the client still uses its original id.
          const relationshipId =
            parentRelationshipIdAlias.get(wire.parentChildRelationshipId)?.id
            ?? wire.parentChildRelationshipId
          const key = associationKey(
            wire.treeId,
            wire.parentChildRelationshipId,
          )
          const updatedAt = wireTimestamp(wire)
          const createdAt = wireCreatedAt(wire)
          if (
            !validId(wire.treeId)
            || !validId(wire.parentChildRelationshipId)
            || !updatedAt
            || !createdAt
            || !canWrite(await roleForTree(wire.treeId))
          ) {
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              false,
            )
            continue
          }
          const relationship = existingParentRelationships.get(relationshipId)
          // The lookup previously filtered `deletedAt IS NULL`; treat a missing or
          // soft-deleted row as a missing parent relationship so the conflict
          // path can report it precisely.
          if (!relationship || relationship.deletedAt) {
            missingParentRelationshipIds.add(relationshipId)
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              false,
            )
            continue
          }
          if (
            !(await activeTreeHasMembers(
              db,
              wire.treeId,
              [relationship.parentPersonId, relationship.childPersonId],
              activePeopleExistForRequest,
            ))
          ) {
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              false,
            )
            continue
          }
          const existing = existingTreeParentRelationships.get(
            associationKey(wire.treeId, relationshipId),
          )
          if (
            !existing
            && !createdParentRelationshipIds.has(relationship.id)
            && !adoptedParentRelationshipIds.has(relationship.id)
            && !(await canWriteExistingParentRelationship(
              db,
              me.id,
              relationship,
              roleForTree,
            ))
          ) {
            classify(
              applied,
              skipped,
              "treeParentChildRelationships",
              key,
              false,
            )
            continue
          }
          const rows = await db
            .insert(treeParentChildRelationships)
            .values({
              treeId: wire.treeId,
              parentChildRelationshipId: relationshipId,
              createdAt,
              updatedAt: serverTime,
            })
            .onConflictDoUpdate({
              target: [
                treeParentChildRelationships.treeId,
                treeParentChildRelationships.parentChildRelationshipId,
              ],
              set: {
                deletedAt: null,
                updatedAt: serverTime,
                revision: sql`${treeParentChildRelationships.revision} + 1`,
              },
              setWhere: eq(
                treeParentChildRelationships.revision,
                parentRelationshipIdAlias.has(wire.parentChildRelationshipId)
                  ? (existing?.revision ?? 0)
                  : (wire.revision ?? 0),
              ),
            })
            .returning({
              treeId: treeParentChildRelationships.treeId,
              revision: treeParentChildRelationships.revision,
            })
          if (
            rows[0]
            && parentRelationshipIdAlias.has(wire.parentChildRelationshipId)
          ) {
            parentAssociationAliases.set(key, {
              parentChildRelationshipId: relationshipId,
              revision: rows[0].revision,
            })
          }
          classify(
            applied,
            skipped,
            "treeParentChildRelationships",
            key,
            rows.length > 0,
          )
        }

        // Stage 4: enforce quotas, emit change-log records, and persist the receipt.
        await tombstoneOrphanParentRelationships(
          db,
          orphanCandidateRelationshipIds,
          serverTime,
        )

        const usageAfter = await loadTreeUsage(db, quotaTreeIds)
        let quotaViolation:
          | {
              treeId: string
              reason: "tree-member-limit" | "tree-related-record-limit"
              maximum: number
              current: number
            }
          | undefined
        for (const treeId of quotaTreeIds) {
          const before = usageBefore.get(treeId) ?? {
            members: 0,
            relatedRecords: 0,
          }
          const after = usageAfter.get(treeId) ?? before
          if (
            after.members > MAX_TREE_MEMBERS
            && after.members > before.members
          ) {
            quotaViolation = {
              treeId,
              reason: "tree-member-limit",
              maximum: MAX_TREE_MEMBERS,
              current: after.members,
            }
            break
          }
          if (
            after.relatedRecords > MAX_TREE_RELATED_RECORDS
            && after.relatedRecords > before.relatedRecords
          ) {
            quotaViolation = {
              treeId,
              reason: "tree-related-record-limit",
              maximum: MAX_TREE_RELATED_RECORDS,
              current: after.relatedRecords,
            }
            break
          }
        }
        if (quotaViolation) {
          if (!mutationId) throw new Error("tree record limit exceeded")
          outcome.conflict = {
            mutationId,
            serverTime: serverTime.toISOString(),
            skipped: requestIds(body),
            retryable: false,
            reason: quotaViolation.reason,
            limit: {
              treeId: quotaViolation.treeId,
              maximum: quotaViolation.maximum,
              current: quotaViolation.current,
            },
          }
          transaction.rollback()
        }

        if (mutationId && !hasClassifiedRecords(skipped)) {
          const changesByTree = await collectMutationChanges(
            db,
            body,
            parentRelationshipIdAlias,
            cascadedReferences,
          )
          for (const [treeId, records] of [...changesByTree].sort(
            ([first], [second]) => first.localeCompare(second),
          )) {
            const versionRows = await db
              .update(trees)
              .set({ syncVersion: sql`${trees.syncVersion} + 1` })
              .where(eq(trees.id, treeId))
              .returning({ version: trees.syncVersion })
            const version = versionRows[0]?.version
            if (version === undefined) continue
            if (
              new TextEncoder().encode(JSON.stringify(records)).byteLength
              <= MAX_RESPONSE_PAGE_BYTES
            ) {
              await db.insert(syncChanges).values({
                treeId,
                version,
                mutationId,
                records,
              })
            }
          }
          const retentionCutoff = new Date(
            serverTime.getTime() - 30 * 24 * 60 * 60 * 1000,
          )
          await Promise.all([
            db
              .delete(syncChanges)
              .where(lt(syncChanges.createdAt, retentionCutoff)),
            db
              .delete(mutationReceipts)
              .where(lt(mutationReceipts.createdAt, retentionCutoff)),
          ])
        }
        const response: SyncPushResponse = {
          applied,
          skipped,
          ...(parentRelationshipIdAlias.size > 0
            ? {
                aliases: {
                  parentChildRelationships: Object.fromEntries(
                    parentRelationshipIdAlias,
                  ),
                  ...(parentAssociationAliases.size > 0
                    ? {
                        treeParentChildRelationships: Object.fromEntries(
                          parentAssociationAliases,
                        ),
                      }
                    : {}),
                },
              }
            : {}),
          serverTime: serverTime.toISOString(),
        }
        if (mutationId && hasClassifiedRecords(skipped)) {
          outcome.conflict = {
            mutationId,
            serverTime: response.serverTime,
            skipped: requestIds(body),
            retryable: true,
            reason:
              missingParentRelationshipIds.size > 0
                ? "missing-parent-relationship"
                : "revision-mismatch",
            ...(missingParentRelationshipIds.size > 0
              ? {
                  missingDependencies: {
                    parentChildRelationships: [...missingParentRelationshipIds],
                  },
                }
              : {}),
          }
          transaction.rollback()
        }
        const responseBody: SyncPushResponse | SyncMutationResponse = mutationId
          ? { ...response, mutationId, status: "applied" }
          : response
        if (mutationId) {
          await db.insert(mutationReceipts).values({
            userId: me.id,
            mutationId,
            response: responseBody,
          })
        }
        return Response.json(responseBody, {
          headers: { "cache-control": "private, no-store" },
        })
      },
    )
    committedResponse = transactionResponse
    await finalizeCommittedPhotos(stagedPhotoLifecycle)
    return transactionResponse
  } catch (error) {
    if (committedResponse) {
      console.error("failed to delete replaced photos", error)
      return committedResponse
    }
    if (photoLifecycle) await discardStagedPhotos(photoLifecycle)
    if (outcome.conflict) {
      const conflict = outcome.conflict
      const authoritativeRecords = conflict.retryable
        ? await collectAuthoritativeConflictRecords(rootDb, me.id, body)
        : emptyRecordSet()
      const conflictResponse: SyncMutationResponse = {
        applied: emptyAppliedIds(),
        skipped: conflict.skipped,
        serverTime: conflict.serverTime,
        mutationId: conflict.mutationId,
        status: "conflict",
        conflict: {
          retryable: conflict.retryable,
          reason: conflict.reason,
          records: authoritativeRecords,
          ...(conflict.missingDependencies
            ? { missingDependencies: conflict.missingDependencies }
            : {}),
          ...(conflict.limit ? { limit: conflict.limit } : {}),
        },
      }
      return Response.json(conflictResponse, {
        status: 409,
        headers: { "cache-control": "private, no-store" },
      })
    }
    throw error
  }
}
