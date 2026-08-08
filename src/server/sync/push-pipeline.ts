import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import type { DB } from "../../db"
import { mutationReceipts, persons, trees, treeUnions } from "../../db/schema"
import type {
  SyncMutationResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "../../sync/types"
import { personRole, type Role, treeRole } from "../acl"
import type { SessionUser } from "../session"
import { tombstoneOrphanParentRelationships } from "../tree-deletion"
import type { ActivePeopleExist, RoleForTree } from "./push-authorize"
import { emitChangeLog, emptyRecordSet } from "./push-changes"
import { collectAuthoritativeConflictRecords } from "./push-conflict"
import type { PhotoLifecycle } from "./push-photos"
import {
  emptyAppliedIds,
  hasClassifiedRecords,
  type MutationApplicationState,
  type MutationConflict,
  type MutationContext,
  type MutationOutcome,
  type RoleForPerson,
  requestIds,
  validId,
} from "./push-state"
import { enforceQuota, loadTreeUsage } from "./push-usage"

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

export async function prepareMutationContext(
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

/**
 * Stage 4: enforce quotas, emit change-log records, and persist the receipt.
 * Runs inside the mutation transaction; calls `rollback()` to abort on an
 * unresolvable conflict (the orchestrator's catch handler then builds the
 * 409 response from `outcome.conflict`).
 */
export async function finalizeMutation(
  ctx: MutationContext,
  state: MutationApplicationState,
  outcome: MutationOutcome,
  rollback: () => never,
): Promise<Response> {
  const { body, db, me, mutationId, quotaTreeIds, serverTime, usageBefore } =
    ctx
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
  const quotaViolation = enforceQuota(usageBefore, usageAfter, quotaTreeIds)
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
    await emitChangeLog(
      db,
      body,
      mutationId,
      serverTime,
      parentRelationshipIdAlias,
      cascadedReferences,
    )
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

/**
 * Builds the 409 conflict response after a rolled-back mutation, attaching the
 * authoritative server-side records the client needs to reconcile.
 */
export async function buildConflictResponse(
  conflict: MutationConflict,
  db: DB,
  userId: string,
  body: SyncPushRequest,
): Promise<Response> {
  const authoritativeRecords = conflict.retryable
    ? await collectAuthoritativeConflictRecords(db, userId, body)
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
