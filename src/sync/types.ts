import type {
  Gender,
  ParentChildRelationshipType,
  UnionEventType,
} from "../types"

export type ShareRole = "viewer" | "editor"
export type LocalRole = "owner" | ShareRole

export type TombstoneWire = {
  id: string
  revision?: number
  updatedAt: string
  deletedAt: string
}

export type PersonRecordWire = {
  id: string
  name: string
  familyName?: string
  dob?: string
  dod?: string
  gender?: Gender
  birthplace?: string
  photo?: string
  hasPhoto?: boolean
  photoUpdatedAt?: string
  revision?: number
  updatedAt: string
  ownerId?: string
}

export type PersonWire = PersonRecordWire | TombstoneWire

export type TreeRecordWire = {
  id: string
  name: string
  createdAt: string
  revision?: number
  updatedAt: string
  ownerId: string
  ownerEmail?: string | null
  role?: LocalRole
}

/** Tree metadata only. Relationship data is transported as normalized rows. */
export type TreeWire = TreeRecordWire | TombstoneWire

export type TreeMemberRecordWire = {
  treeId: string
  personId: string
  createdAt: string
  revision?: number
  updatedAt: string
}

export type TreeMemberTombstoneWire = {
  treeId: string
  personId: string
  revision?: number
  updatedAt: string
  deletedAt: string
}

export type TreeMemberWire = TreeMemberRecordWire | TreeMemberTombstoneWire

export type UnionRecordWire = {
  id: string
  firstPersonId: string
  secondPersonId: string
  createdAt: string
  revision?: number
  updatedAt: string
}

export type UnionWire = UnionRecordWire | TombstoneWire

export type UnionEventRecordWire = {
  id: string
  unionId: string
  type: UnionEventType
  eventDate?: string
  createdAt: string
  revision?: number
  updatedAt: string
}

export type UnionEventWire = UnionEventRecordWire | TombstoneWire

export type TreeUnionRecordWire = {
  treeId: string
  unionId: string
  createdAt: string
  revision?: number
  updatedAt: string
}

export type TreeUnionTombstoneWire = {
  treeId: string
  unionId: string
  revision?: number
  updatedAt: string
  deletedAt: string
}

export type TreeUnionWire = TreeUnionRecordWire | TreeUnionTombstoneWire

export type ParentChildRelationshipRecordWire = {
  id: string
  parentPersonId: string
  childPersonId: string
  type: ParentChildRelationshipType
  createdAt: string
  revision?: number
  updatedAt: string
}

export type ParentChildRelationshipWire =
  | ParentChildRelationshipRecordWire
  | TombstoneWire

export type TreeParentChildRelationshipRecordWire = {
  treeId: string
  parentChildRelationshipId: string
  createdAt: string
  revision?: number
  updatedAt: string
}

export type TreeParentChildRelationshipTombstoneWire = {
  treeId: string
  parentChildRelationshipId: string
  revision?: number
  updatedAt: string
  deletedAt: string
}

export type TreeParentChildRelationshipWire =
  | TreeParentChildRelationshipRecordWire
  | TreeParentChildRelationshipTombstoneWire

export type SyncRecordSet = {
  persons: PersonWire[]
  trees: TreeWire[]
  treeMembers: TreeMemberWire[]
  unions: UnionWire[]
  unionEvents: UnionEventWire[]
  treeUnions: TreeUnionWire[]
  parentChildRelationships: ParentChildRelationshipWire[]
  treeParentChildRelationships: TreeParentChildRelationshipWire[]
}

export type SharedTreeWire = Omit<SyncRecordSet, "trees"> & {
  tree: TreeRecordWire
  role: ShareRole
  ownerEmail: string | null
}

export type SyncPullResponse = {
  own: SyncRecordSet
  shared: SharedTreeWire[]
  serverTime: string
  nextCursor?: string
}

export type PersonPushRecordWire = Omit<
  PersonRecordWire,
  "ownerId" | "photo" | "hasPhoto" | "photoUpdatedAt"
> & {
  /** Omitted keeps the stored photo; null removes it; a data URL replaces it. */
  photo?: string | null
  /**
   * Set by an explicit "Your device" conflict resolution to make the local
   * value win: the server bypasses the optimistic-concurrency revision
   * precondition while still enforcing ACL and the no-resurrect guard.
   */
  force?: boolean
}
export type PersonPushWire = PersonPushRecordWire | TombstoneWire
export type TreePushRecordWire = Omit<
  TreeRecordWire,
  "ownerId" | "ownerEmail" | "role"
>
export type TreePushWire = TreePushRecordWire | TombstoneWire

export type SyncPushRequest = {
  persons: PersonPushWire[]
  trees: TreePushWire[]
  treeMembers: TreeMemberWire[]
  unions: UnionWire[]
  unionEvents: UnionEventWire[]
  treeUnions: TreeUnionWire[]
  parentChildRelationships: ParentChildRelationshipWire[]
  treeParentChildRelationships: TreeParentChildRelationshipWire[]
}

export type SyncAppliedIds = {
  persons: string[]
  trees: string[]
  treeMembers: string[]
  unions: string[]
  unionEvents: string[]
  treeUnions: string[]
  parentChildRelationships: string[]
  treeParentChildRelationships: string[]
}

export type SyncPushResponse = {
  applied: SyncAppliedIds
  skipped: SyncAppliedIds
  aliases?: {
    parentChildRelationships: Record<
      string,
      { id: string; revision: number; type: ParentChildRelationshipType }
    >
    treeParentChildRelationships?: Record<
      string,
      { parentChildRelationshipId: string; revision: number }
    >
  }
  serverTime: string
}

export type SyncMutationRequest = {
  protocolVersion: 2
  deviceId: string
  mutationId: string
  records: SyncPushRequest
}

export type SyncMutationResponse = SyncPushResponse & {
  mutationId: string
  status: "applied" | "alreadyApplied" | "conflict"
  conflict?: {
    retryable: boolean
    reason:
      | "revision-mismatch"
      | "missing-parent-relationship"
      | "tree-member-limit"
      | "tree-related-record-limit"
    records: SyncRecordSet
    missingDependencies?: {
      parentChildRelationships: string[]
    }
    limit?: {
      treeId: string
      maximum: number
      current: number
    }
  }
}

export type TreeManifestItem = TreeRecordWire & {
  memberCount: number
  syncVersion: number
}

export type TreeManifestResponse = {
  trees: TreeManifestItem[]
  nextCursor?: string
}

export type AncestorTreeLink = { personId: string; treeId: string }

/**
 * An ancestor-family tree the viewer cannot access (neither owns nor is shared
 * on), surfaced only so the card can offer a "request access" badge. Carries
 * the tree name because the client has no other way to resolve it — consistent
 * with the public invite preview, which exposes a tree name by id.
 */
export type RequestableAncestorLink = {
  personId: string
  treeId: string
  treeName: string
}

export type TreeSnapshotResponse = {
  tree: TreeRecordWire
  records: Omit<SyncRecordSet, "trees">
  /** Earliest accessible ancestor-family tree per visible person, so the
   *  client can show the "ancestor family" label without loading every tree. */
  ancestorTrees?: AncestorTreeLink[]
  /** Earliest inaccessible ancestor-family tree per visible person (when no
   *  accessible one exists), so the card can offer a "request access" badge. */
  requestableAncestors?: RequestableAncestorLink[]
  syncVersion: number
  cursor: string
  partial?: boolean
  boundaryPersonIds?: string[]
  nextCursor?: string
}

export type SyncChangePage = {
  treeId: string
  changes: Array<{
    version: number
    mutationId: string
    records: SyncRecordSet
  }>
  cursor: string
  hasMore: boolean
}

/**
 * Human-readable recent-activity feed for a tree, derived from the same
 * `sync_changes` rows the sync protocol writes. Unlike {@link SyncChangePage}
 * this is a simple newest-first recent-N read (no cursor, no "reset required"
 * semantics) intended for the settings "Activity" panel.
 */
export type TreeActivityChange = {
  version: number
  mutationId: string
  createdAt: string
  records: SyncRecordSet
  /**
   * Who made this change, resolved by joining `mutation_receipts` → `user` on
   * the change's `mutationId`. `null` when no receipt survives (the change is
   * older than the 30-day retention window or was made without a mutation id).
   * The server resolves the requester's own edits to the name "You".
   */
  author: { name: string } | null
}

export type TreeActivityResponse = {
  treeId: string
  changes: TreeActivityChange[]
}
