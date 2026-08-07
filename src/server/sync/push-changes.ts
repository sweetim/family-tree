import { eq, inArray, lt, or, sql } from "drizzle-orm"
import type { DB } from "../../db"
import {
  mutationReceipts,
  parentChildRelationships,
  persons,
  syncChanges,
  treeMembers,
  treeParentChildRelationships,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type { SyncPushRequest, SyncRecordSet } from "../../sync/types"
import type { ParentChildRelationshipType } from "../../types"
import { MAX_RESPONSE_PAGE_BYTES } from "../limits"
import { associationKey } from "../sync-validation"
import {
  type CascadedTreeReferences,
  emptyCascadedTreeReferences,
} from "./push-state"
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

export function emptyRecordSet(): SyncRecordSet {
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

export async function collectMutationChanges(
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

export async function emitChangeLog(
  db: DB,
  body: SyncPushRequest,
  mutationId: string,
  serverTime: Date,
  parentAliases: ReadonlyMap<
    string,
    { id: string; revision: number; type: ParentChildRelationshipType }
  >,
  cascadedReferences: CascadedTreeReferences,
): Promise<void> {
  const changesByTree = await collectMutationChanges(
    db,
    body,
    parentAliases,
    cascadedReferences,
  )
  for (const [treeId, records] of [...changesByTree].sort(([first], [second]) =>
    first.localeCompare(second),
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
