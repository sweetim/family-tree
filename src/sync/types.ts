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
  dob?: string
  dod?: string
  gender?: Gender
  location?: string
  photo?: string
  hasPhoto?: boolean
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
}

export type PersonPushRecordWire = Omit<
  PersonRecordWire,
  "ownerId" | "photo" | "hasPhoto"
> & {
  /** Omitted keeps the stored photo; null removes it; a data URL replaces it. */
  photo?: string | null
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
}

export type TreeManifestItem = TreeRecordWire & {
  memberCount: number
  syncVersion: number
}

export type TreeManifestResponse = {
  trees: TreeManifestItem[]
  nextCursor?: string
}

export type TreeSnapshotResponse = {
  tree: TreeRecordWire
  records: Omit<SyncRecordSet, "trees">
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
