/**
 * ConflictLog — the owned-state unit for sync conflict detection,
 * presentation, and resolution.
 *
 * Owns its singletons (`operationConflicts`, `syncConflicts`, the cleared
 * sets, `conflictResolutionInFlight`, `blockedChangesCache`) and exposes a
 * small lifecycle API (`serializeConflicts` / `hydrateConflicts` /
 * `applyPersistedConflicts` / `resetConflicts`) so the core lifecycle in
 * `state.ts` never reaches in to reassign them. Reads the graph/outbox via
 * the live bindings and getters exported from `state.ts`, and writes the
 * graph through `update()`.
 */

import type {
  ParentChildRelationshipRecordWire,
  PersonRecordWire,
  SyncMutationResponse,
  SyncPullResponse,
  SyncRecordSet,
  TreeParentChildRelationshipRecordWire,
} from "../sync/types"
import {
  bumpRevision,
  clearedDirtyTokens,
  dirtyState,
  dirtyToken,
} from "./dirty"
import type {
  PersistedConflict,
  PersistedOperationConflict,
  PersistedStore,
} from "./persistence"
import type {
  BlockedChange,
  DirtyCollection,
  DirtyRecord,
  DirtyState,
  GlobalState,
  TreeMeta,
} from "./state"
import {
  applyFullPull,
  getBlockedChangesVersion,
  getSnapshot,
  getStoreGeneration,
  getSyncStatus,
  makeDraft,
  notifyListeners,
  setSyncStatus,
  statusFromDirtyState,
  update,
} from "./state"
import {
  persistCurrentStore,
  schedulePersistence,
} from "./persistence-coordinator"
import {
  activePushPromise,
  pushDirty,
  runWithCrossTabSyncLock,
  storeInstanceId,
} from "./coordinator"
import {
  blockedChangesForTree,
  isStoredPhotoMarker,
  newId,
  now,
  pullRecordSet,
  RECORD_COLLECTIONS,
  recordSetValue,
  STORED_PHOTO_MARKER,
  treeParentChildRelationshipKey,
  valueFor,
} from "./state-internals"
import { fetchFullPull, fetchTreeSnapshot } from "./sync-transport"

// ---------------------------------------------------------------------------
// Owned singletons.
// ---------------------------------------------------------------------------

let operationConflicts: PersistedOperationConflict[] = []
let syncConflicts: PersistedConflict[] = []
const clearedOperationConflictIds = new Set<string>()
const clearedConflictIds = new Set<string>()
let conflictResolutionInFlight: Promise<unknown> | undefined
const blockedChangesCache = new Map<
  string,
  { version: number; changes: BlockedChange[] }
>()

// ---------------------------------------------------------------------------
// Read accessors for the core/reactive layer.
// ---------------------------------------------------------------------------

export function getOperationConflicts(): PersistedOperationConflict[] {
  return operationConflicts
}

export function getSyncConflicts(): PersistedConflict[] {
  return syncConflicts
}

export function getConflictResolutionInFlight(): Promise<unknown> | undefined {
  return conflictResolutionInFlight
}

// ---------------------------------------------------------------------------
// Lifecycle: persistence snapshot/restore/reset.
// ---------------------------------------------------------------------------

export function serializeConflicts() {
  return {
    conflicts: syncConflicts,
    clearedConflictIds: [...clearedConflictIds],
    operationConflicts,
    clearedOperationConflictIds: [...clearedOperationConflictIds],
  }
}

/** Apply the merged result returned by `savePersistedStore` after a write. */
export function applyPersistedConflicts(persisted: PersistedStore): void {
  syncConflicts = persisted.conflicts ?? []
  operationConflicts = persisted.operationConflicts ?? []
  clearedOperationConflictIds.clear()
  for (const id of persisted.clearedOperationConflictIds ?? []) {
    clearedOperationConflictIds.add(id)
  }
}

/** Restore the full conflict state from a loaded persisted store. */
export function hydrateConflicts(persisted: PersistedStore): void {
  syncConflicts = persisted.conflicts ?? []
  operationConflicts = persisted.operationConflicts ?? []
  clearedOperationConflictIds.clear()
  for (const id of persisted.clearedOperationConflictIds ?? []) {
    clearedOperationConflictIds.add(id)
  }
  clearedConflictIds.clear()
  for (const conflictId of persisted.clearedConflictIds ?? []) {
    clearedConflictIds.add(conflictId)
  }
}

export function resetConflicts(): void {
  operationConflicts = []
  syncConflicts = []
  clearedOperationConflictIds.clear()
  clearedConflictIds.clear()
  conflictResolutionInFlight = undefined
  blockedChangesCache.clear()
}

/** Invalidate the blocked-changes projection cache (called on notification). */
export function clearBlockedChangesCache(): void {
  blockedChangesCache.clear()
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

type ConflictRecordRef = { collection: DirtyCollection; id: string }
type ResolvedConflictRecord = ConflictRecordRef & { dirty: DirtyRecord }
type CanonicalAdoption = {
  localRelationshipId: string
  canonicalRelationship: ParentChildRelationshipRecordWire
  associations: Array<{
    localKey: string
    canonicalKey: string
    canonicalAssociation: TreeParentChildRelationshipRecordWire
  }>
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

function isCurrentConflictRecord(
  current: DirtyRecord | undefined,
  record: PersistedOperationConflict["records"][number],
  operationId: string,
): current is DirtyRecord {
  return Boolean(
    current
      && (current.conflictId === operationId
        || (!current.conflictId
          && current.blocked
          && (current.operationId === record.dirty.operationId
            || current.sourceId === record.dirty.sourceId))),
  )
}

function collectLegacyBlockedRecords(
  dirty: DirtyState,
  operationId: string,
): ResolvedConflictRecord[] {
  return RECORD_COLLECTIONS.flatMap((collection) =>
    [...dirty[collection]]
      .filter(
        ([id, record]) =>
          record.blocked
          && (record.operationId === operationId
            || `${collection}:${id}` === operationId),
      )
      .map(([id, dirtyRecord]) => ({
        collection,
        id,
        dirty: dirtyRecord,
      })),
  )
}

function collectCapturedConflictRecords(
  dirty: DirtyState,
  conflict: PersistedOperationConflict | undefined,
  operationId: string,
): ResolvedConflictRecord[] {
  if (!conflict) return []
  return conflict.records.flatMap((record) => {
    const current = dirty[record.collection].get(record.id)
    return isCurrentConflictRecord(current, record, operationId)
      ? [{ collection: record.collection, id: record.id, dirty: current }]
      : []
  })
}

function matchesCapturedIntent(
  current: DirtyRecord | undefined,
  captured: DirtyRecord,
): current is DirtyRecord {
  return Boolean(
    current?.blocked
      && current.operationId === captured.operationId
      && current.sourceId === captured.sourceId
      && current.action === captured.action,
  )
}

function revisionIn(
  records: SyncRecordSet | undefined,
  record: ConflictRecordRef,
): number | undefined {
  return records
    ? (
        recordSetValue(records, record.collection, record.id) as
          | { revision?: number }
          | undefined
      )?.revision
    : undefined
}

function snapshotRevisionFor(
  freshRecords: SyncRecordSet | undefined,
  freshTreeRevision: number | undefined,
  treeId: string,
  record: ConflictRecordRef,
): number | undefined {
  return record.collection === "trees" && record.id === treeId
    ? freshTreeRevision
    : revisionIn(freshRecords, record)
}

function capturedRevisionFor(
  conflict: PersistedOperationConflict | undefined,
  record: ConflictRecordRef,
): number | undefined {
  return (
    conflict?.records.find(
      (candidate) =>
        candidate.collection === record.collection
        && candidate.id === record.id,
    )?.serverValue as { revision?: number } | undefined
  )?.revision
}

/** Detects whether a "missing-parent-relationship" conflict is in fact
 *  already satisfied on the server by a canonical relationship. Returns the
 *  computed adoptions so the caller can apply them once. Pure: reads the
 *  supplied state/dirty snapshots and fresh records without mutation. */
function computeCanonicalAdoptions(
  stateSnapshot: GlobalState,
  dirty: DirtyState,
  currentRecords: ResolvedConflictRecord[],
  freshRecords: SyncRecordSet,
): {
  adoptions: CanonicalAdoption[]
  authoritativePeople: Map<string, PersonRecordWire>
  operationAlreadyExistsOnServer: boolean
} {
  const serverRelationships = freshRecords.parentChildRelationships.filter(
    (wire): wire is ParentChildRelationshipRecordWire => !("deletedAt" in wire),
  )
  const serverAssociations = freshRecords.treeParentChildRelationships.filter(
    (wire): wire is TreeParentChildRelationshipRecordWire =>
      !("deletedAt" in wire),
  )
  const coveredRecords = new Set<string>()
  const adoptions: CanonicalAdoption[] = []

  for (const record of currentRecords) {
    if (record.collection !== "parentChildRelationships") continue
    const current = dirty.parentChildRelationships.get(record.id)
    const localRelationship = stateSnapshot.parentChildRelationships[record.id]
    if (!matchesCapturedIntent(current, record.dirty) || !localRelationship) {
      continue
    }
    const canonicalRelationship = serverRelationships.find(
      (candidate) =>
        candidate.parentPersonId === localRelationship.parentPersonId
        && candidate.childPersonId === localRelationship.childPersonId,
    )
    if (!canonicalRelationship) continue

    const localAssociations = currentRecords.filter((candidate) => {
      if (candidate.collection !== "treeParentChildRelationships") {
        return false
      }
      return (
        stateSnapshot.treeParentChildRelationships[candidate.id]
          ?.parentChildRelationshipId === record.id
      )
    })
    if (localAssociations.length === 0) continue

    const associations: CanonicalAdoption["associations"] = []
    let allAssociationsExist = true
    for (const associationRecord of localAssociations) {
      const localAssociation =
        stateSnapshot.treeParentChildRelationships[associationRecord.id]
      const canonicalAssociation = serverAssociations.find(
        (candidate) =>
          candidate.treeId === localAssociation?.treeId
          && candidate.parentChildRelationshipId === canonicalRelationship.id,
      )
      if (!localAssociation || !canonicalAssociation) {
        allAssociationsExist = false
        break
      }
      associations.push({
        localKey: associationRecord.id,
        canonicalKey: treeParentChildRelationshipKey(
          canonicalAssociation.treeId,
          canonicalRelationship.id,
        ),
        canonicalAssociation,
      })
    }
    if (!allAssociationsExist) continue

    coveredRecords.add(`parentChildRelationships:${record.id}`)
    for (const association of associations) {
      coveredRecords.add(`treeParentChildRelationships:${association.localKey}`)
    }
    adoptions.push({
      localRelationshipId: record.id,
      canonicalRelationship,
      associations,
    })
  }

  const linkedPersonIds = new Set(
    adoptions.flatMap((adoption) => [
      adoption.canonicalRelationship.parentPersonId,
      adoption.canonicalRelationship.childPersonId,
    ]),
  )
  const serverPeople = freshRecords.persons.filter(
    (wire): wire is PersonRecordWire => !("deletedAt" in wire),
  )
  const authoritativePeople = new Map<string, PersonRecordWire>()
  for (const record of currentRecords) {
    if (record.collection !== "persons" || !linkedPersonIds.has(record.id)) {
      continue
    }
    const current = dirty.persons.get(record.id)
    const localPerson = stateSnapshot.persons[record.id]
    const serverPerson = serverPeople.find(
      (candidate) => candidate.id === record.id,
    )
    if (
      !matchesCapturedIntent(current, record.dirty)
      || !localPerson
      || !serverPerson
    ) {
      continue
    }
    const photoMatches = serverPerson.hasPhoto
      ? isStoredPhotoMarker(localPerson.photo)
      : localPerson.photo === serverPerson.photo
    if (
      localPerson.name === serverPerson.name
      && localPerson.familyName === (serverPerson.familyName ?? "")
      && localPerson.dob === serverPerson.dob
      && localPerson.dod === serverPerson.dod
      && localPerson.gender === serverPerson.gender
      && localPerson.birthplace === serverPerson.birthplace
      && photoMatches
    ) {
      coveredRecords.add(`persons:${record.id}`)
      authoritativePeople.set(record.id, serverPerson)
    }
  }

  const operationAlreadyExistsOnServer =
    adoptions.length > 0
    && currentRecords.every((record) =>
      coveredRecords.has(`${record.collection}:${record.id}`),
    )
  return {
    adoptions,
    authoritativePeople,
    operationAlreadyExistsOnServer,
  }
}

// ---------------------------------------------------------------------------
// Outbox-driven conflict capture.
// ---------------------------------------------------------------------------

export function snapshotOperationConflict(
  source: DirtyState,
  operationId: string | undefined,
  result: SyncMutationResponse,
): void {
  const id = operationId ?? "legacy-operation"
  if (operationConflicts.some((conflict) => conflict.operationId === id)) return
  const records = RECORD_COLLECTIONS.flatMap((collection) =>
    [...source[collection]]
      .filter(([, dirty]) => dirty.operationId === operationId)
      .map(([recordId, dirty]) => ({
        collection,
        id: recordId,
        dirty: structuredClone(dirty),
        conflictId: id,
        deviceValue: structuredClone(
          valueFor(getSnapshot(), collection, recordId),
        ),
        serverValue: structuredClone(
          result.conflict
            ? recordSetValue(result.conflict.records, collection, recordId)
            : undefined,
        ),
      })),
  )
  operationConflicts.push({
    operationId: id,
    reason: result.conflict?.reason ?? "revision-mismatch",
    retryable: result.conflict?.retryable ?? false,
    records,
  })
  for (const collection of RECORD_COLLECTIONS) {
    for (const [recordId, sent] of source[collection]) {
      if (sent.operationId !== operationId) continue
      const current = dirtyState[collection].get(recordId)
      if (current?.revision === sent.revision) {
        dirtyState[collection].set(recordId, { ...current, conflictId: id })
      }
    }
  }
}

export function recreateMissingParentDependencies(
  source: DirtyState,
  operationId: string | undefined,
  result: SyncMutationResponse,
): void {
  if (
    !operationId
    || result.status !== "conflict"
    || result.conflict?.reason !== "missing-parent-relationship"
  ) {
    return
  }
  const skippedAssociations = new Set(
    result.skipped.treeParentChildRelationships,
  )
  const missingRelationshipIds = new Set(
    result.conflict.missingDependencies?.parentChildRelationships ?? [],
  )
  const replacements = new Map<string, string>()
  for (const [id, associationDirty] of source.treeParentChildRelationships) {
    if (associationDirty.action !== "upsert" || !skippedAssociations.has(id)) {
      continue
    }
    const association = getSnapshot().treeParentChildRelationships[id]
    const currentAssociationDirty =
      dirtyState.treeParentChildRelationships.get(id)
    if (!association) continue
    const relationshipId = association.parentChildRelationshipId
    if (!missingRelationshipIds.has(relationshipId)) continue
    const relationship = getSnapshot().parentChildRelationships[relationshipId]
    const sourceRelationshipDirty =
      source.parentChildRelationships.get(relationshipId)
    const currentRelationshipDirty =
      dirtyState.parentChildRelationships.get(relationshipId)
    if (
      !relationship
      || currentAssociationDirty?.revision !== associationDirty.revision
      || (currentRelationshipDirty
        && (currentRelationshipDirty.operationId !== operationId
          || currentRelationshipDirty.revision
            !== sourceRelationshipDirty?.revision))
    ) {
      continue
    }
    const existingReplacementId = replacements.get(relationshipId)
    const replacementRelationshipId = existingReplacementId ?? newId()
    replacements.set(relationshipId, replacementRelationshipId)
    const replacementAssociationId = treeParentChildRelationshipKey(
      association.treeId,
      replacementRelationshipId,
    )
    const timestamp = now()
    const hasOtherAssociation = Object.entries(
      getSnapshot().treeParentChildRelationships,
    ).some(
      ([key, candidate]) =>
        key !== id && candidate.parentChildRelationshipId === relationshipId,
    )
    update(
      (previous) => {
        const next = makeDraft(previous)
        delete next.treeParentChildRelationships[id]
        next.treeParentChildRelationships[replacementAssociationId] = {
          ...association,
          parentChildRelationshipId: replacementRelationshipId,
          revision: undefined,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        if (!hasOtherAssociation) {
          delete next.parentChildRelationships[relationshipId]
        }
        if (!existingReplacementId) {
          next.parentChildRelationships[replacementRelationshipId] = {
            ...relationship,
            id: replacementRelationshipId,
            revision: undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
          }
        }
        return next
      },
      { remote: true },
    )
    const token = dirtyToken(
      "treeParentChildRelationships",
      id,
      currentAssociationDirty,
    )
    if (token) clearedDirtyTokens.add(token)
    const replacementAssociationDirty: DirtyRecord = {
      ...associationDirty,
      revision: bumpRevision(),
      baseRevision: undefined,
      blocked: true,
      operationId,
      conflictId: undefined,
    }
    source.treeParentChildRelationships.delete(id)
    source.treeParentChildRelationships.set(
      replacementAssociationId,
      replacementAssociationDirty,
    )
    dirtyState.treeParentChildRelationships.delete(id)
    dirtyState.treeParentChildRelationships.set(
      replacementAssociationId,
      replacementAssociationDirty,
    )
    if (!existingReplacementId) {
      if (currentRelationshipDirty) {
        const relationshipToken = dirtyToken(
          "parentChildRelationships",
          relationshipId,
          currentRelationshipDirty,
        )
        if (relationshipToken) clearedDirtyTokens.add(relationshipToken)
        source.parentChildRelationships.delete(relationshipId)
        dirtyState.parentChildRelationships.delete(relationshipId)
      }
      const dependencyDirty: DirtyRecord = {
        action: "upsert",
        revision: bumpRevision(),
        blocked: true,
        operationId,
        sourceId: associationDirty.sourceId ?? storeInstanceId,
        changedAt: associationDirty.changedAt ?? Date.now(),
      }
      source.parentChildRelationships.set(
        replacementRelationshipId,
        dependencyDirty,
      )
      dirtyState.parentChildRelationships.set(
        replacementRelationshipId,
        dependencyDirty,
      )
    }
  }
}

/** Clear acknowledgements only when the shipped revision is still current. */
export function hasNewerDirtyRecords(shipped: DirtyState): boolean {
  return RECORD_COLLECTIONS.some((collection) =>
    [...dirtyState[collection]].some(([id, current]) => {
      const sent = shipped[collection].get(id)
      return !sent || sent.revision !== current.revision
    }),
  )
}

export function blockOperation(
  source: DirtyState,
  operationId: string | undefined,
): void {
  for (const collection of RECORD_COLLECTIONS) {
    for (const [id, sent] of source[collection]) {
      if (sent.operationId !== operationId) continue
      const current = dirtyState[collection].get(id)
      if (current?.revision === sent.revision) {
        dirtyState[collection].set(id, { ...current, blocked: true })
      }
    }
  }
  schedulePersistence()
  setSyncStatus("conflict")
}

// ---------------------------------------------------------------------------
// Blocked-changes projection.
// ---------------------------------------------------------------------------

/** Server conflict reasons are protocol values; the panel shows people text. */
function conflictReasonText(reason: string, retryable: boolean): string {
  if (!retryable) {
    return reason === "tree-member-limit"
      ? "This tree has reached its limit on members."
      : reason === "tree-related-record-limit"
        ? "This tree has reached its limit on records."
        : "The server would not accept this change. Use the server version."
  }
  return reason === "missing-parent-relationship"
    ? "A record this change depends on is missing on the server."
    : "This change conflicts with a newer server version."
}

export function getBlockedChangesSnapshot(treeId: string): BlockedChange[] {
  const cached = blockedChangesCache.get(treeId)
  if (cached?.version === getBlockedChangesVersion()) return cached.changes
  const fallback = blockedChangesForTree(getSnapshot(), dirtyState, treeId)
  const changes = fallback.map((change) => {
    const conflict = operationConflicts.find(
      (candidate) => candidate.operationId === change.id,
    )
    if (!conflict) return change
    const fields = (value: unknown) => {
      if (value === undefined) return []
      if (!value || typeof value !== "object") {
        return [{ label: "Value", value: String(value) }]
      }
      return Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["revision", "updatedAt", "ownerId"].includes(key))
        .map(([label, fieldValue]) => ({
          label,
          value: fieldValue == null ? "Not set" : String(fieldValue),
        }))
    }
    const semanticFields = (
      side: "device" | "server",
    ): Array<{ label: string; value: string }> => {
      const summaries = conflict.records.flatMap((record) => {
        if (record.collection === "treeMembers") {
          return [
            {
              label: "Tree membership",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Removed from this tree"
                  : side === "server" && record.serverValue
                    ? "Member of this tree"
                    : "Not a member of this tree",
            },
          ]
        }
        if (
          record.collection === "parentChildRelationships"
          || record.collection === "treeParentChildRelationships"
        ) {
          return [
            {
              label: "Parent relationship",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Relationship removed"
                  : side === "server" && record.serverValue
                    ? "Relationship kept"
                    : "Relationship not present",
            },
          ]
        }
        if (record.collection === "treeUnions") {
          return [
            {
              label: "Marriage connection",
              value:
                side === "device" && record.dirty.action === "delete"
                  ? "Connection removed"
                  : side === "server" && record.serverValue
                    ? "Connection kept"
                    : "Connection not present",
            },
          ]
        }
        return fields(
          side === "device" ? record.deviceValue : record.serverValue,
        )
      })
      const unique = [
        ...new Map(
          summaries.map((summary) => [
            `${summary.label}:${summary.value}`,
            summary,
          ]),
        ).values(),
      ]
      return unique.length > 0
        ? unique
        : [{ label: "Result", value: "Details unavailable" }]
    }
    return {
      ...change,
      reason: conflictReasonText(conflict.reason, conflict.retryable),
      retryable: conflict.retryable,
      device: semanticFields("device"),
      server: semanticFields("server"),
    }
  })
  blockedChangesCache.set(treeId, {
    version: getBlockedChangesVersion(),
    changes,
  })
  return changes
}

// ---------------------------------------------------------------------------
// Operation conflict resolution.
// ---------------------------------------------------------------------------

export async function resolveBlockedOperation(
  operationId: string,
  resolution: "device" | "server",
  treeId: string,
  attempt = 0,
): Promise<"resolved" | "stale" | "conflict" | "offline" | "unresolvable"> {
  const conflict = operationConflicts.find(
    (candidate) => candidate.operationId === operationId,
  )
  const capturedRecords = collectCapturedConflictRecords(
    dirtyState,
    conflict,
    operationId,
  )
  const legacyRecords = collectLegacyBlockedRecords(dirtyState, operationId)
  // A persisted conflict snapshot can drift out of sync with the live outbox
  // (cross-version persistence, a dependency-id rewrite, etc.). Always fall
  // back to the live blocked records for this operation so the user's choice
  // is acted on instead of silently no-op'ing as "stale".
  const currentRecords =
    capturedRecords.length > 0 ? capturedRecords : legacyRecords
  if (currentRecords.length === 0) {
    if (conflict) {
      operationConflicts = operationConflicts.filter(
        (candidate) => candidate.operationId !== operationId,
      )
      clearedOperationConflictIds.add(operationId)
      schedulePersistence()
      notifyListeners()
    }
    return "stale"
  }

  if (resolution === "server") {
    return resolveBlockedOnServer(operationId, conflict, currentRecords)
  }
  return resolveBlockedOnDevice(
    operationId,
    conflict,
    currentRecords,
    treeId,
    attempt,
  )
}

// Resolution path for "keep the server's version": fetch the authoritative
// full pull, drop the captured device records, and overwrite the local graph
// so the user's intent becomes "accept what the server has".
async function resolveBlockedOnServer(
  operationId: string,
  conflict: PersistedOperationConflict | undefined,
  currentRecords: ResolvedConflictRecord[],
): Promise<"resolved" | "stale" | "offline"> {
  const resolutionGeneration = getStoreGeneration()
  const existingPush = activePushPromise()
  const execute = async () => {
    if (existingPush) await existingPush
    if (resolutionGeneration !== getStoreGeneration()) return "stale" as const
    return runWithCrossTabSyncLock(async () => {
      let pull: SyncPullResponse
      try {
        pull = await fetchFullPull()
      } catch {
        return "offline" as const
      }
      let cleared = 0
      for (const record of currentRecords) {
        const current = dirtyState[record.collection].get(record.id)
        if (!matchesCapturedIntent(current, record.dirty)) continue
        const token = dirtyToken(record.collection, record.id, current)
        if (token) clearedDirtyTokens.add(token)
        dirtyState[record.collection].delete(record.id)
        cleared++
      }
      if (cleared === 0) return "stale" as const
      if (conflict) {
        operationConflicts = operationConflicts.filter(
          (candidate) => candidate.operationId !== operationId,
        )
        clearedOperationConflictIds.add(operationId)
      }
      applyFullPull(pull)
      schedulePersistence()
      setSyncStatus(statusFromDirtyState())
      notifyListeners()
      await persistCurrentStore()
      return "resolved" as const
    })
  }
  const resolutionPromise = execute().finally(() => {
    if (conflictResolutionInFlight === resolutionPromise) {
      conflictResolutionInFlight = undefined
    }
  })
  conflictResolutionInFlight = resolutionPromise
  return resolutionPromise
}

// Resolution path for "keep my version": refresh the optimistic-concurrency
// base from a live snapshot, rebase the blocked records onto it, and retry the
// push. Handles the missing-parent-relationship reconciliation, offline
// fallback, and the retry/progress bookkeeping that decides whether to loop,
// re-surface the conflict, or give up.
async function resolveBlockedOnDevice(
  operationId: string,
  conflict: PersistedOperationConflict | undefined,
  currentRecords: ResolvedConflictRecord[],
  treeId: string,
  attempt: number,
): Promise<"resolved" | "stale" | "conflict" | "offline" | "unresolvable"> {
  // Drop the captured conflict up front so a re-conflict can snapshot a
  // refreshed version under the same operation id. Reusing the id keeps the
  // review item stable instead of surfacing a duplicate under a new id. The
  // captured conflict is restored on the offline path so its comparison stays
  // available, and the id is only marked cleared once the push truly succeeds.
  if (conflict) {
    operationConflicts = operationConflicts.filter(
      (candidate) => candidate.operationId !== operationId,
    )
  }
  // Refresh the optimistic-concurrency base from a live snapshot so the retry
  // targets the server's current revision, not the one captured when the
  // conflict was first detected. The device version is kept; only the base
  // revision is refreshed. When the fetch fails (offline) the captured
  // revision is used and the push/offline handling below takes over.
  let freshRecords: SyncRecordSet | undefined
  let freshTreeRevision: number | undefined
  try {
    const snapshot = await fetchTreeSnapshot(treeId)
    freshRecords = { trees: [], ...snapshot.records }
    freshTreeRevision = snapshot.tree.revision
  } catch {
    freshRecords = undefined
  }
  if (conflict?.reason === "missing-parent-relationship" && freshRecords) {
    const { adoptions, authoritativePeople, operationAlreadyExistsOnServer } =
      computeCanonicalAdoptions(
        getSnapshot(),
        dirtyState,
        currentRecords,
        freshRecords,
      )
    if (operationAlreadyExistsOnServer) {
      for (const record of currentRecords) {
        const current = dirtyState[record.collection].get(record.id)
        if (!matchesCapturedIntent(current, record.dirty)) continue
        const token = dirtyToken(record.collection, record.id, current)
        if (token) clearedDirtyTokens.add(token)
        dirtyState[record.collection].delete(record.id)
      }
      update(
        (previous) => {
          const parentChildRelationships = {
            ...previous.parentChildRelationships,
          }
          const treeParentChildRelationships = {
            ...previous.treeParentChildRelationships,
          }
          const persons = { ...previous.persons }
          for (const serverPerson of authoritativePeople.values()) {
            persons[serverPerson.id] = {
              id: serverPerson.id,
              name: serverPerson.name,
              familyName: serverPerson.familyName ?? "",
              dob: serverPerson.dob,
              dod: serverPerson.dod,
              gender: serverPerson.gender,
              birthplace: serverPerson.birthplace,
              photo: serverPerson.hasPhoto
                ? STORED_PHOTO_MARKER
                : serverPerson.photo,
              revision: serverPerson.revision,
              updatedAt: serverPerson.updatedAt,
              ownerId: serverPerson.ownerId,
            }
          }
          for (const adoption of adoptions) {
            delete parentChildRelationships[adoption.localRelationshipId]
            parentChildRelationships[adoption.canonicalRelationship.id] = {
              ...adoption.canonicalRelationship,
            }
            for (const association of adoption.associations) {
              delete treeParentChildRelationships[association.localKey]
              treeParentChildRelationships[association.canonicalKey] = {
                ...association.canonicalAssociation,
              }
            }
          }
          return {
            ...previous,
            persons,
            parentChildRelationships,
            treeParentChildRelationships,
          }
        },
        { remote: true },
      )
      clearedOperationConflictIds.add(operationId)
      schedulePersistence()
      setSyncStatus(statusFromDirtyState())
      notifyListeners()
      await persistCurrentStore()
      return "resolved"
    }
  }
  // A tree snapshot only covers records still attached to that tree, and the
  // captured conflict only covers what the server chose to return. When
  // neither knows the authoritative revision of a record that does exist on
  // the server, the retry would resend the rejected base verbatim and be
  // refused again, so fall back to a pull, which spans every accessible
  // record.
  let pulledRecords: SyncRecordSet | undefined
  const missingAuthoritativeRevision = currentRecords.some((record) => {
    const current = dirtyState[record.collection].get(record.id)
    return (
      current?.baseRevision !== undefined
      && snapshotRevisionFor(freshRecords, freshTreeRevision, treeId, record)
        === undefined
      && capturedRevisionFor(conflict, record) === undefined
    )
  })
  if (missingAuthoritativeRevision) {
    try {
      pulledRecords = pullRecordSet(await fetchFullPull())
    } catch {
      pulledRecords = undefined
    }
  }
  const attemptedBases = new Map<string, number | undefined>()
  let requeued = 0
  for (const record of currentRecords) {
    const current = dirtyState[record.collection].get(record.id)
    if (!matchesCapturedIntent(current, record.dirty)) continue
    const conflictRecord = conflict?.records.find(
      (candidate) =>
        candidate.collection === record.collection
        && candidate.id === record.id,
    )
    const capturedRevision = capturedRevisionFor(conflict, record)
    const freshRevision =
      snapshotRevisionFor(freshRecords, freshTreeRevision, treeId, record)
      ?? revisionIn(pulledRecords, record)
    if (
      conflictRecord
      && current.action === "delete"
      && !conflictRecord.serverValue
    ) {
      const token = dirtyToken(record.collection, record.id, current)
      if (token) clearedDirtyTokens.add(token)
      dirtyState[record.collection].delete(record.id)
      continue
    }
    const baseRevision =
      freshRevision ?? capturedRevision ?? current.baseRevision
    attemptedBases.set(`${record.collection}:${record.id}`, baseRevision)
    dirtyState[record.collection].set(record.id, {
      ...current,
      blocked: false,
      baseRevision,
      revision: bumpRevision(),
      operationId,
      conflictId: undefined,
      force: true,
    })
    requeued++
  }
  if (requeued === 0) {
    if (conflict) clearedOperationConflictIds.add(operationId)
    schedulePersistence()
    setSyncStatus(statusFromDirtyState())
    notifyListeners()
    await persistCurrentStore()
    return "resolved"
  }
  schedulePersistence()
  setSyncStatus(statusFromDirtyState())
  notifyListeners()
  const activePush = activePushPromise()
  if (activePush) await activePush
  await pushDirty()
  if (getSyncStatus() === "offline") {
    for (const record of currentRecords) {
      const current = dirtyState[record.collection].get(record.id)
      if (current?.operationId !== operationId) continue
      dirtyState[record.collection].set(record.id, {
        ...record.dirty,
        blocked: true,
        revision: bumpRevision(),
      })
    }
    if (conflict) operationConflicts = [...operationConflicts, conflict]
    setSyncStatus(statusFromDirtyState())
    schedulePersistence()
    notifyListeners()
    await persistCurrentStore()
    return "offline"
  }
  const retriedConflict = operationConflicts.find(
    (candidate) => candidate.operationId === operationId,
  )
  if (retriedConflict) {
    const recreatedMissingDependency =
      retriedConflict.reason === "missing-parent-relationship"
      && retriedConflict.records.some(
        (record) => !attemptedBases.has(`${record.collection}:${record.id}`),
      )
    if (recreatedMissingDependency) {
      // Recurse once to push the freshly-minted relationship id. If that
      // still misses its dependency, minting more ids cannot help—stop so
      // we never loop snapshot→mutation→sync indefinitely.
      if (attempt >= 1) return "unresolvable"
      return resolveBlockedOperation(operationId, "device", treeId, attempt + 1)
    }
    // The rebased mutation was refused too. If the server reports the same
    // revisions this attempt already sent — or reports none at all — nothing
    // a further retry could send would differ, so the record was refused for
    // a reason optimistic concurrency cannot fix (a removed or unreachable
    // record, or a dependency the server does not have). Stop offering the
    // retry instead of looping the identical mutation.
    const madeProgress = retriedConflict.records.some((record) => {
      const key = `${record.collection}:${record.id}`
      if (!attemptedBases.has(key)) return false
      const serverRevision = (
        record.serverValue as { revision?: number } | undefined
      )?.revision
      return (
        serverRevision !== undefined
        && serverRevision !== attemptedBases.get(key)
      )
    })
    if (!madeProgress) {
      operationConflicts = operationConflicts.map((candidate) =>
        candidate.operationId === operationId
          ? { ...candidate, retryable: false }
          : candidate,
      )
      schedulePersistence()
      notifyListeners()
      await persistCurrentStore()
      return "unresolvable"
    }
    return "conflict"
  }
  if (conflict) clearedOperationConflictIds.add(operationId)
  schedulePersistence()
  notifyListeners()
  await persistCurrentStore()
  return "resolved"
}

export function resolveNextSyncConflict(
  resolution: "current" | "alternate",
): void {
  const conflict = syncConflicts.shift()
  if (!conflict) return
  clearedConflictIds.add(conflict.conflictId)

  if (resolution === "alternate") {
    update((previous) => {
      const draft = makeDraft(previous)
      if (conflict.collection === "trees") {
        draft.index = previous.index.filter((tree) => tree.id !== conflict.id)
        if (conflict.record.action === "upsert" && conflict.value) {
          const current = previous.index.find((tree) => tree.id === conflict.id)
          draft.index.push({
            ...(conflict.value as TreeMeta),
            revision: current?.revision,
            updatedAt: current?.updatedAt,
            ownerId: current?.ownerId,
            ownerEmail: current?.ownerEmail,
            role: current?.role,
          })
        }
      } else {
        const records = draft[conflict.collection] as unknown as Record<
          string,
          unknown
        >
        if (conflict.record.action === "delete") delete records[conflict.id]
        else if (conflict.value !== undefined) {
          const current = records[conflict.id]
          records[conflict.id] =
            current
            && typeof current === "object"
            && conflict.value
            && typeof conflict.value === "object"
              ? {
                  ...(conflict.value as Record<string, unknown>),
                  revision: (current as { revision?: number }).revision,
                  updatedAt: (current as { updatedAt?: string }).updatedAt,
                }
              : conflict.value
        }
      }
      return draft
    })
    return
  }

  const current = dirtyState[conflict.collection].get(conflict.id)
  if (current) {
    dirtyState[conflict.collection].set(conflict.id, {
      ...current,
      blocked: false,
      revision: bumpRevision(),
      operationId: newId(),
      sourceId: storeInstanceId,
      changedAt: Date.now(),
    })
    setSyncStatus("saving")
    schedulePersistence()
    notifyListeners()
    void pushDirty()
  } else {
    setSyncStatus(statusFromDirtyState())
    schedulePersistence()
    notifyListeners()
  }
}
