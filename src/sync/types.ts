import type { LocalRole, ShareRole } from "../store"
import type { TreeEdges } from "../types"

/**
 * Wire shape for a person over the sync API. Tombstones carry `deletedAt`;
 * clients then drop the local record. `ownerId` is set on shared-tree members
 * so an editor's edit is attributed correctly server-side.
 */
export interface PersonWire {
  id: string
  name: string
  dob?: string
  dod?: string
  gender?: string
  location?: string
  photo?: string
  updatedAt: string
  deletedAt?: string
  ownerId?: string
}

/** Wire shape for a tree over the sync API. */
export interface TreeWire {
  id: string
  name: string
  edges: TreeEdges
  createdAt: string
  updatedAt: string
  deletedAt?: string
  ownerId: string
  /** Email of the tree's owner. Populated by the server for shared trees. */
  ownerEmail?: string | null
  /** Role the *current user* has on this tree — populated by the server. */
  role?: LocalRole
}

export interface SharedTreeWire {
  tree: TreeWire
  persons: PersonWire[]
  role: ShareRole
  ownerEmail: string | null
}

export interface SyncPullResponse {
  own: { persons: PersonWire[]; trees: TreeWire[] }
  shared: SharedTreeWire[]
  serverTime: string
}

export interface SyncPushRequest {
  persons: PersonWire[]
  trees: TreeWire[]
}

export interface SyncPushResponse {
  applied: { persons: string[]; trees: string[] }
  skipped: { persons: string[]; trees: string[] }
  serverTime: string
}
