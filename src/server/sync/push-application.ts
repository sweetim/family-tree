import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type { ParentChildRelationshipType } from "../../types"
import { canWrite } from "../acl"
import { deletePhoto, isPhotoDataUrl } from "../blob"
import {
  associationKey,
  clientCanTombstone,
  GENDERS,
  isCanonicalUnion,
  isValidIsoDate,
  PARENT_RELATIONSHIP_TYPES,
  UNION_EVENT_TYPES,
} from "../sync-validation"
import { tombstoneOwnedTree } from "../tree-deletion"
import {
  activeTreeHasMembers,
  canWriteExistingParentRelationship,
  canWriteExistingUnion,
  hasWritableTreeContaining,
} from "./push-authorize"
import {
  resolvePreuploadedPhoto,
  resolvePreuploadedPhotoUpdate,
} from "./push-photos"
import {
  classify,
  type MutationApplicationState,
  type MutationContext,
  validId,
  wireCreatedAt,
  wireRevision,
  wireTimestamp,
} from "./push-state"
import {
  tombstonePersonCascade,
  tombstonePersonReferencesInTrees,
} from "./push-tombstone"

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
export async function applyRemovals(
  ctx: MutationContext,
  state: MutationApplicationState,
): Promise<void> {
  const {
    body,
    db,
    me,
    ownedPersonIds,
    personRoleCache,
    photoLifecycle,
    roleForTree,
    serverTime,
    treeRoleCache,
  } = ctx
  const {
    applied,
    cascadedReferences,
    orphanCandidateRelationshipIds,
    skipped,
  } = state
  const ownedPersonDeleteIds = new Set(
    body.persons
      .filter((wire) => "deletedAt" in wire && ownedPersonIds.has(wire.id))
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
    const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
    if (cascadeParentIds.has(wire.parentChildRelationshipId)) {
      classify(applied, skipped, "treeParentChildRelationships", key, true)
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
      classify(applied, skipped, "treeParentChildRelationships", key, false)
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
      cascadedReferences.treeUnionKeys.add(associationKey(treeId, unionId))
    }
    for (const { treeId, parentChildRelationshipId } of parentAssociations) {
      orphanCandidateRelationshipIds.add(parentChildRelationshipId)
      cascadedReferences.parentRelationshipIds.add(parentChildRelationshipId)
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
    classify(applied, skipped, "treeMembers", removal.key, rows.length > 0)
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
      photoLifecycle.photosToDeleteAfterCommit,
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
}

export async function applyUpserts(
  ctx: MutationContext,
  state: MutationApplicationState,
): Promise<void> {
  const {
    activePeopleExistForRequest,
    body,
    db,
    me,
    personRoleCache,
    photoLifecycle,
    roleForPerson,
    roleForTree,
    serverTime,
    treeRoleCache,
  } = ctx
  const {
    applied,
    missingParentRelationshipIds,
    parentAssociationAliases,
    parentRelationshipIdAlias,
    skipped,
  } = state
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
  const existingTrees = new Map(treeRows.map((row) => [row.id, row] as const))

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
        photo = resolvePreuploadedPhoto(photoLifecycle, wire.photo)
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
          photoUpdatedAt: photo ? serverTime : null,
          updatedAt: serverTime,
        })
        .onConflictDoNothing()
        .returning({ id: persons.id })
      if (rows.length === 0 && photo) await deletePhoto(photo)
      if (rows.length > 0) {
        if (photo) photoLifecycle.consumedPhotos.add(photo)
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
        photoLifecycle,
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
               "photo_updated_at" = CASE
                 WHEN ${photo}::text IS NULL THEN NULL
                 WHEN "photo" IS DISTINCT FROM ${photo} THEN ${serverTime}
                 ELSE "photo_updated_at"
               END,
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
      photoLifecycle.photosToDeleteAfterCommit.add(previousPhoto)
    }
    if (updated && photo && photo !== previousPhoto && !isPhotoDataUrl(photo)) {
      photoLifecycle.consumedPhotos.add(photo)
    }
    classify(applied, skipped, "persons", wire.id, updated)
  }

  await activePeopleExistForRequest([
    ...body.treeMembers.flatMap((wire) =>
      "deletedAt" in wire ? [] : [wire.personId],
    ),
    ...body.unions.flatMap((wire) =>
      "deletedAt" in wire ? [] : [wire.firstPersonId, wire.secondPersonId],
    ),
    ...body.parentChildRelationships.flatMap((wire) =>
      "deletedAt" in wire ? [] : [wire.parentPersonId, wire.childPersonId],
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
  const existingUnions = new Map(unionRows.map((row) => [row.id, row] as const))

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
      classify(applied, skipped, "parentChildRelationships", wire.id, false)
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
        classify(applied, skipped, "parentChildRelationships", wire.id, false)
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
        const canonical = await db.query.parentChildRelationships.findFirst({
          where: and(
            eq(parentChildRelationships.parentPersonId, wire.parentPersonId),
            eq(parentChildRelationships.childPersonId, wire.childPersonId),
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
      classify(applied, skipped, "parentChildRelationships", wire.id, inserted)
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
      classify(applied, skipped, "parentChildRelationships", wire.id, false)
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
          eq(parentChildRelationships.parentPersonId, wire.parentPersonId),
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
        where: inArray(treeParentChildRelationships.treeId, parentRelTreeIds),
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
    const key = associationKey(wire.treeId, wire.parentChildRelationshipId)
    const updatedAt = wireTimestamp(wire)
    const createdAt = wireCreatedAt(wire)
    if (
      !validId(wire.treeId)
      || !validId(wire.parentChildRelationshipId)
      || !updatedAt
      || !createdAt
      || !canWrite(await roleForTree(wire.treeId))
    ) {
      classify(applied, skipped, "treeParentChildRelationships", key, false)
      continue
    }
    const relationship = existingParentRelationships.get(relationshipId)
    // The lookup previously filtered `deletedAt IS NULL`; treat a missing or
    // soft-deleted row as a missing parent relationship so the conflict
    // path can report it precisely.
    if (!relationship || relationship.deletedAt) {
      missingParentRelationshipIds.add(relationshipId)
      classify(applied, skipped, "treeParentChildRelationships", key, false)
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
      classify(applied, skipped, "treeParentChildRelationships", key, false)
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
      classify(applied, skipped, "treeParentChildRelationships", key, false)
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
}
