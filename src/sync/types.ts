import type { LocalRole, ShareRole } from "../store"
import type {
  Gender,
  ParentChildRelationshipType,
  UnionEventType,
} from "../types"

export type TombstoneWire = {
  id: string
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
  updatedAt: string
  ownerId?: string
}

export type PersonWire = PersonRecordWire | TombstoneWire

export type TreeRecordWire = {
  id: string
  name: string
  createdAt: string
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
  updatedAt: string
}

export type TreeMemberTombstoneWire = {
  treeId: string
  personId: string
  updatedAt: string
  deletedAt: string
}

export type TreeMemberWire = TreeMemberRecordWire | TreeMemberTombstoneWire

export type UnionRecordWire = {
  id: string
  firstPersonId: string
  secondPersonId: string
  createdAt: string
  updatedAt: string
}

export type UnionWire = UnionRecordWire | TombstoneWire

export type UnionEventRecordWire = {
  id: string
  unionId: string
  type: UnionEventType
  eventDate?: string
  createdAt: string
  updatedAt: string
}

export type UnionEventWire = UnionEventRecordWire | TombstoneWire

export type TreeUnionRecordWire = {
  treeId: string
  unionId: string
  createdAt: string
  updatedAt: string
}

export type TreeUnionTombstoneWire = {
  treeId: string
  unionId: string
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
  updatedAt: string
}

export type ParentChildRelationshipWire =
  | ParentChildRelationshipRecordWire
  | TombstoneWire

export type TreeParentChildRelationshipRecordWire = {
  treeId: string
  parentChildRelationshipId: string
  createdAt: string
  updatedAt: string
}

export type TreeParentChildRelationshipTombstoneWire = {
  treeId: string
  parentChildRelationshipId: string
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

export type SyncPushRequest = SyncRecordSet

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
  serverTime: string
}
