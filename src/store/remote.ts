/**
 * Remote-record merging. Each function mutates the shared singletons
 * (`dirtyState`, `remoteTombstoneClocks`) via live bindings from `state.ts`,
 * and writes the graph through `update()`. `applyFullPull` (the full epoch
 * reset+replay) stays in `state.ts` because it reassigns the core singletons
 * directly; it calls back into `applyRemote` here.
 */

import type {
  ParentChildRelationshipWire,
  PersonWire,
  SyncPullResponse,
  SyncPushResponse,
  TreeMemberWire,
  TreeParentChildRelationshipWire,
  TreeUnionWire,
  TreeWire,
  UnionEventWire,
  UnionWire,
} from "../sync/types"
import { dirtyState } from "./dirty"
import {
  type DirtyCollection,
  type DirtyState,
  type GlobalState,
  remoteTombstoneClocks,
  type TreeMeta,
  update,
} from "./state"
import {
  RECORD_COLLECTIONS,
  type RemoteWire,
  remoteIsNewer,
  STORED_PHOTO_MARKER,
  treeMemberKey,
  treeParentChildRelationshipKey,
  treeUnionKey,
} from "./state-internals"

function tombstoneBlocks(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
  revision?: number,
): boolean {
  const clock = remoteTombstoneClocks[collection].get(id)
  if (!clock) return false
  if (clock.revision !== undefined && revision !== undefined) {
    return clock.revision >= revision
  }
  return clock.updatedAt >= updatedAt
}

export function recordTombstone(
  collection: DirtyCollection,
  id: string,
  updatedAt: string,
  revision?: number,
): void {
  const current = remoteTombstoneClocks[collection].get(id)
  if (
    !current
    || (revision !== undefined && current.revision !== undefined
      ? revision > current.revision
      : updatedAt > current.updatedAt)
  ) {
    remoteTombstoneClocks[collection].set(id, { updatedAt, revision })
  }
}

function mergeRemoteRecords<
  T extends { updatedAt: string; revision?: number },
  W extends RemoteWire,
>(
  records: Record<string, T>,
  wires: Iterable<W> | undefined,
  collection: Exclude<DirtyCollection, "persons" | "trees">,
  keyFor: (wire: W) => string,
  toRecord: (wire: W) => T,
): Record<string, T> {
  if (!wires) return records
  let result = records
  for (const wire of wires) {
    const id = keyFor(wire)
    const local = result[id]
    if (tombstoneBlocks(collection, id, wire.updatedAt, wire.revision)) continue
    if (dirtyState[collection].has(id)) continue
    if (local && !remoteIsNewer(local, wire)) continue
    if (result === records) result = { ...records }
    if (wire.deletedAt) {
      recordTombstone(collection, id, wire.updatedAt, wire.revision)
      delete result[id]
    } else result[id] = toRecord(wire)
  }
  return result
}

export type RemoteRecords = {
  persons?: Iterable<PersonWire>
  trees?: Iterable<TreeWire>
  treeMembers?: Iterable<TreeMemberWire>
  unions?: Iterable<UnionWire>
  unionEvents?: Iterable<UnionEventWire>
  treeUnions?: Iterable<TreeUnionWire>
  parentChildRelationships?: Iterable<ParentChildRelationshipWire>
  treeParentChildRelationships?: Iterable<TreeParentChildRelationshipWire>
}

/** Merge each normalized record independently using its own timestamp. */
export function applyRemote(remote: RemoteRecords): void {
  update(
    (previous) => {
      let persons = previous.persons
      if (remote.persons) {
        for (const wire of remote.persons) {
          const local = persons[wire.id]
          if (
            tombstoneBlocks("persons", wire.id, wire.updatedAt, wire.revision)
          ) {
            continue
          }
          if (dirtyState.persons.has(wire.id)) continue
          if (local && !remoteIsNewer(local, wire)) continue
          if (persons === previous.persons) persons = { ...persons }
          if ("deletedAt" in wire) {
            recordTombstone("persons", wire.id, wire.updatedAt, wire.revision)
            delete persons[wire.id]
          } else {
            persons[wire.id] = {
              id: wire.id,
              name: wire.name,
              familyName: wire.familyName ?? "",
              dob: wire.dob,
              dod: wire.dod,
              gender: wire.gender,
              birthplace: wire.birthplace,
              photo: wire.hasPhoto ? STORED_PHOTO_MARKER : wire.photo,
              photoUpdatedAt: wire.photoUpdatedAt,
              revision: wire.revision,
              updatedAt: wire.updatedAt,
              ownerId: wire.ownerId,
            }
          }
        }
      }

      let index = previous.index
      const deletedTrees = new Map<string, string>()
      if (remote.trees) {
        const byId = new Map(index.map((tree) => [tree.id, tree] as const))
        for (const wire of remote.trees) {
          const local = byId.get(wire.id)
          if (
            tombstoneBlocks("trees", wire.id, wire.updatedAt, wire.revision)
          ) {
            continue
          }
          const dirtyTree = dirtyState.trees.get(wire.id)
          if (dirtyTree) {
            if (!("deletedAt" in wire) && local) {
              const role = wire.role ?? local.role
              const ownerEmail =
                wire.ownerEmail !== undefined
                  ? wire.ownerEmail
                  : local.ownerEmail
              if (role !== local.role || ownerEmail !== local.ownerEmail) {
                if (index === previous.index) index = [...index]
                const position = index.findIndex((tree) => tree.id === wire.id)
                if (position >= 0)
                  index[position] = { ...local, role, ownerEmail }
              }
            }
            continue
          }
          if ("deletedAt" in wire) {
            if (local && !remoteIsNewer(local, wire)) continue
          } else if (local) {
            const role = wire.role ?? local.role
            const ownerEmail =
              wire.ownerEmail !== undefined ? wire.ownerEmail : local.ownerEmail
            const accessChanged =
              role !== local.role || ownerEmail !== local.ownerEmail
            if (!remoteIsNewer(local, wire)) {
              if (accessChanged) {
                if (index === previous.index) index = [...index]
                const position = index.findIndex((tree) => tree.id === wire.id)
                const replacement = { ...local, role, ownerEmail }
                if (position >= 0) index[position] = replacement
                byId.set(wire.id, replacement)
              }
              continue
            }
            if ((local.updatedAt ?? "") === wire.updatedAt && !accessChanged) {
              continue
            }
          }
          if (index === previous.index) index = [...index]
          const position = index.findIndex((tree) => tree.id === wire.id)
          if ("deletedAt" in wire) {
            if (position >= 0) index.splice(position, 1)
            recordTombstone("trees", wire.id, wire.updatedAt, wire.revision)
            deletedTrees.set(wire.id, wire.updatedAt)
            byId.delete(wire.id)
          } else {
            const replacement: TreeMeta = {
              id: wire.id,
              name: wire.name,
              createdAt: wire.createdAt,
              revision: wire.revision,
              updatedAt: wire.updatedAt,
              ownerId: wire.ownerId,
              ownerEmail: wire.ownerEmail ?? local?.ownerEmail,
              role: wire.role ?? local?.role,
              syncVersion: local?.syncVersion,
              memberCount: local?.memberCount,
              loaded: local?.loaded,
            }
            if (position >= 0) index[position] = replacement
            else index.push(replacement)
            byId.set(wire.id, replacement)
          }
        }
      }

      let treeMembers = mergeRemoteRecords(
        previous.treeMembers,
        remote.treeMembers,
        "treeMembers",
        (wire) => treeMemberKey(wire.treeId, wire.personId),
        (wire) => {
          if (!("createdAt" in wire)) throw new Error("Invalid member wire")
          return wire
        },
      )
      const unions = mergeRemoteRecords(
        previous.unions,
        remote.unions,
        "unions",
        (wire) => wire.id,
        (wire) => {
          if (!("firstPersonId" in wire)) throw new Error("Invalid union wire")
          return wire
        },
      )
      const unionEvents = mergeRemoteRecords(
        previous.unionEvents,
        remote.unionEvents,
        "unionEvents",
        (wire) => wire.id,
        (wire) => {
          if (!("unionId" in wire)) throw new Error("Invalid union event wire")
          return wire
        },
      )
      let treeUnions = mergeRemoteRecords(
        previous.treeUnions,
        remote.treeUnions,
        "treeUnions",
        (wire) => treeUnionKey(wire.treeId, wire.unionId),
        (wire) => {
          if (!("createdAt" in wire)) throw new Error("Invalid tree union wire")
          return wire
        },
      )
      const parentChildRelationships = mergeRemoteRecords(
        previous.parentChildRelationships,
        remote.parentChildRelationships,
        "parentChildRelationships",
        (wire) => wire.id,
        (wire) => {
          if (!("parentPersonId" in wire)) {
            throw new Error("Invalid parent-child wire")
          }
          return wire
        },
      )
      let treeParentChildRelationships = mergeRemoteRecords(
        previous.treeParentChildRelationships,
        remote.treeParentChildRelationships,
        "treeParentChildRelationships",
        (wire) =>
          treeParentChildRelationshipKey(
            wire.treeId,
            wire.parentChildRelationshipId,
          ),
        (wire) => {
          if (!("createdAt" in wire)) {
            throw new Error("Invalid tree parent-child wire")
          }
          return wire
        },
      )

      if (deletedTrees.size > 0) {
        for (const [key, record] of Object.entries(treeMembers)) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeMembers", key, deletedAt)
        }
        for (const [key, record] of Object.entries(treeUnions)) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeUnions", key, deletedAt)
        }
        for (const [key, record] of Object.entries(
          treeParentChildRelationships,
        )) {
          const deletedAt = deletedTrees.get(record.treeId)
          if (!deletedAt) continue
          recordTombstone("treeParentChildRelationships", key, deletedAt)
        }
        treeMembers = Object.fromEntries(
          Object.entries(treeMembers).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
        treeUnions = Object.fromEntries(
          Object.entries(treeUnions).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
        treeParentChildRelationships = Object.fromEntries(
          Object.entries(treeParentChildRelationships).filter(
            ([, record]) => !deletedTrees.has(record.treeId),
          ),
        )
      }

      const next: GlobalState = {
        persons,
        index,
        treeMembers,
        unions,
        unionEvents,
        treeUnions,
        parentChildRelationships,
        treeParentChildRelationships,
      }
      return Object.keys(next).every(
        (key) =>
          next[key as keyof GlobalState] === previous[key as keyof GlobalState],
      )
        ? previous
        : next
    },
    { remote: true },
  )
}

export function sharedRemoteRecords(
  shared: SyncPullResponse["shared"][number],
): RemoteRecords {
  return {
    persons: shared.persons,
    trees: [
      {
        ...shared.tree,
        role: shared.role,
        ownerEmail: shared.ownerEmail,
      },
    ],
    treeMembers: shared.treeMembers,
    unions: shared.unions,
    unionEvents: shared.unionEvents,
    treeUnions: shared.treeUnions,
    parentChildRelationships: shared.parentChildRelationships,
    treeParentChildRelationships: shared.treeParentChildRelationships,
  }
}

export function acknowledgeApplied(
  result: SyncPushResponse,
  shipped: DirtyState,
): void {
  const acknowledgedRevisions = Object.fromEntries(
    RECORD_COLLECTIONS.map((collection) => [
      collection,
      new Map<string, number>(),
    ]),
  ) as Record<DirtyCollection, Map<string, number>>

  for (const collection of RECORD_COLLECTIONS) {
    for (const id of result.applied[collection]) {
      const sent = shipped[collection].get(id)
      if (!sent) continue
      const revision = (sent.baseRevision ?? 0) + 1
      acknowledgedRevisions[collection].set(id, revision)
      const pending = dirtyState[collection].get(id)
      if (pending && pending.revision !== sent.revision) {
        dirtyState[collection].set(id, { ...pending, baseRevision: revision })
      }
    }
  }

  update(
    (previous) => {
      let persons = previous.persons
      for (const [id, revision] of acknowledgedRevisions.persons) {
        const person = persons[id]
        if (!person) continue
        if (persons === previous.persons) persons = { ...persons }
        persons[id] = { ...person, revision, updatedAt: result.serverTime }
      }

      let index = previous.index
      for (const [id, revision] of acknowledgedRevisions.trees) {
        const position = index.findIndex((tree) => tree.id === id)
        if (position < 0) continue
        if (index === previous.index) index = [...index]
        const tree = index[position]
        if (tree) {
          index[position] = { ...tree, revision, updatedAt: result.serverTime }
        }
      }

      const stampCollection = <
        T extends { revision?: number; updatedAt: string },
      >(
        records: Record<string, T>,
        collection: Exclude<DirtyCollection, "persons" | "trees">,
      ): Record<string, T> => {
        let next = records
        for (const [id, revision] of acknowledgedRevisions[collection]) {
          const record = next[id]
          if (!record) continue
          if (next === records) next = { ...records }
          next[id] = { ...record, revision, updatedAt: result.serverTime }
        }
        return next
      }

      return {
        ...previous,
        persons,
        index,
        treeMembers: stampCollection(previous.treeMembers, "treeMembers"),
        unions: stampCollection(previous.unions, "unions"),
        unionEvents: stampCollection(previous.unionEvents, "unionEvents"),
        treeUnions: stampCollection(previous.treeUnions, "treeUnions"),
        parentChildRelationships: stampCollection(
          previous.parentChildRelationships,
          "parentChildRelationships",
        ),
        treeParentChildRelationships: stampCollection(
          previous.treeParentChildRelationships,
          "treeParentChildRelationships",
        ),
      }
    },
    { remote: true },
  )
}

export function applyAliases(result: SyncPushResponse): void {
  const aliases = result.aliases?.parentChildRelationships
  if (!aliases || Object.keys(aliases).length === 0) return

  update(
    (previous) => {
      const parentChildRelationships = { ...previous.parentChildRelationships }
      const treeParentChildRelationships = {
        ...previous.treeParentChildRelationships,
      }
      for (const [clientId, canonical] of Object.entries(aliases)) {
        const local = parentChildRelationships[clientId]
        if (local) {
          delete parentChildRelationships[clientId]
          parentChildRelationships[canonical.id] = {
            ...local,
            id: canonical.id,
            revision: canonical.revision,
            type: canonical.type,
            updatedAt: result.serverTime,
          }
        }
        const dirtyFact = dirtyState.parentChildRelationships.get(clientId)
        if (dirtyFact) {
          dirtyState.parentChildRelationships.delete(clientId)
          dirtyState.parentChildRelationships.set(canonical.id, {
            ...dirtyFact,
            baseRevision: canonical.revision,
          })
        }
        for (const [key, association] of Object.entries(
          treeParentChildRelationships,
        )) {
          if (association.parentChildRelationshipId !== clientId) continue
          delete treeParentChildRelationships[key]
          const canonicalKey = treeParentChildRelationshipKey(
            association.treeId,
            canonical.id,
          )
          treeParentChildRelationships[canonicalKey] = {
            ...association,
            parentChildRelationshipId: canonical.id,
            revision:
              result.aliases?.treeParentChildRelationships?.[key]?.revision
              ?? association.revision,
            updatedAt: result.serverTime,
          }
          const dirtyAssociation =
            dirtyState.treeParentChildRelationships.get(key)
          if (dirtyAssociation) {
            dirtyState.treeParentChildRelationships.delete(key)
            dirtyState.treeParentChildRelationships.set(
              canonicalKey,
              dirtyAssociation,
            )
          }
        }
      }
      return {
        ...previous,
        parentChildRelationships,
        treeParentChildRelationships,
      }
    },
    { remote: true },
  )
}
