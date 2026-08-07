import type { DB } from "../../db"
import type {
  SyncAppliedIds,
  SyncMutationResponse,
  SyncPushRequest,
} from "../../sync/types"
import type { ParentChildRelationshipType } from "../../types"
import type { Role } from "../acl"
import type { SessionUser } from "../session"
import { associationKey } from "../sync-validation"
import type { ActivePeopleExist, RoleForTree } from "./push-authorize"
import type { PhotoLifecycle } from "./push-photos"

export type SyncCollection = keyof SyncAppliedIds

export type TreeUsage = { members: number; relatedRecords: number }

export type CascadedTreeReferences = {
  unionIds: Set<string>
  parentRelationshipIds: Set<string>
  treeUnionKeys: Set<string>
  treeParentRelationshipKeys: Set<string>
}

export type RoleForPerson = (personId: string) => Promise<Role | null>

export type MutationContext = {
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

export type MutationApplicationState = {
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

export type MutationConflict = {
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

export type MutationOutcome = {
  conflict?: MutationConflict
}

export function emptyAppliedIds(): SyncAppliedIds {
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

export function emptyCascadedTreeReferences(): CascadedTreeReferences {
  return {
    unionIds: new Set(),
    parentRelationshipIds: new Set(),
    treeUnionKeys: new Set(),
    treeParentRelationshipKeys: new Set(),
  }
}

export function createMutationApplicationState(): MutationApplicationState {
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

export function requestIds(body: SyncPushRequest): SyncAppliedIds {
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

export function classify(
  applied: SyncAppliedIds,
  skipped: SyncAppliedIds,
  collection: SyncCollection,
  id: string,
  wasApplied: boolean,
): void {
  ;(wasApplied ? applied : skipped)[collection].push(id)
}

export function wireTimestamp(wire: { updatedAt: string }): Date | null {
  const value = new Date(wire.updatedAt)
  return Number.isFinite(value.getTime()) ? value : null
}

export function wireCreatedAt(wire: { createdAt: string }): Date | null {
  const value = new Date(wire.createdAt)
  return Number.isFinite(value.getTime()) ? value : null
}

export function wireRevision(wire: { revision?: number }): number | null {
  return Number.isSafeInteger(wire.revision) && (wire.revision ?? 0) > 0
    ? (wire.revision as number)
    : null
}

export function hasClassifiedRecords(ids: SyncAppliedIds): boolean {
  return Object.values(ids).some((records) => records.length > 0)
}
