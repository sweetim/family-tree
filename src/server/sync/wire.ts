import type {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  trees,
  treeUnions,
  unionEvents,
  unions,
} from "../../db/schema"
import type {
  ParentChildRelationshipWire,
  PersonWire,
  TombstoneWire,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "../../sync/types"
import type {
  Gender,
  ParentChildRelationshipType,
  UnionEventType,
} from "../../types"
import type { Role } from "../acl"

function iso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString()
}

function tombstone(
  id: string,
  updatedAt: Date | string,
  deletedAt: Date | string,
): TombstoneWire {
  return { id, updatedAt: iso(updatedAt), deletedAt: iso(deletedAt) }
}

export function personToWire(row: typeof persons.$inferSelect): PersonWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    name: row.name,
    dob: row.dob ?? undefined,
    dod: row.dod ?? undefined,
    gender: (row.gender as Gender | null) ?? undefined,
    location: row.location ?? undefined,
    hasPhoto: Boolean(row.photo),
    updatedAt: iso(row.updatedAt),
    ownerId: row.ownerId,
  }
}

export function treeToWire(
  row: typeof trees.$inferSelect,
  role: Role,
  ownerEmail?: string | null,
): TreeWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    name: row.name,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ownerId: row.ownerId,
    ownerEmail,
    role,
  }
}

export function treeMemberToWire(
  row: typeof treeMembers.$inferSelect,
): TreeMemberWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      personId: row.personId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    personId: row.personId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function unionToWire(row: typeof unions.$inferSelect): UnionWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    firstPersonId: row.firstPersonId,
    secondPersonId: row.secondPersonId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function unionEventToWire(
  row: typeof unionEvents.$inferSelect,
): UnionEventWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    unionId: row.unionId,
    type: row.type as UnionEventType,
    eventDate: row.eventDate ?? undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function treeUnionToWire(
  row: typeof treeUnions.$inferSelect,
): TreeUnionWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      unionId: row.unionId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    unionId: row.unionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function parentRelationshipToWire(
  row: typeof parentChildRelationships.$inferSelect,
): ParentChildRelationshipWire {
  if (row.deletedAt) return tombstone(row.id, row.updatedAt, row.deletedAt)
  return {
    id: row.id,
    parentPersonId: row.parentPersonId,
    childPersonId: row.childPersonId,
    type: row.type as ParentChildRelationshipType,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function treeParentRelationshipToWire(
  row: typeof treeParentChildRelationships.$inferSelect,
): TreeParentChildRelationshipWire {
  if (row.deletedAt) {
    return {
      treeId: row.treeId,
      parentChildRelationshipId: row.parentChildRelationshipId,
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    }
  }
  return {
    treeId: row.treeId,
    parentChildRelationshipId: row.parentChildRelationshipId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}
