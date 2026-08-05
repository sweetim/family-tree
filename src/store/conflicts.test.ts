import { describe, expect, test } from "bun:test"
import {
  applyPersistedConflicts,
  getBlockedChangesSnapshot,
  getOperationConflicts,
  getSyncConflicts,
  hydrateConflicts,
  resetConflicts,
  serializeConflicts,
} from "./conflicts"
import { dirtyState } from "./dirty"
import type { PersistedConflict, PersistedStore } from "./persistence"
import type { DirtyRecord } from "./state"
import { notifyListeners, resetStore, update } from "./state"
import { emptyState, treeMemberKey } from "./state-internals"

const ts = "2024-01-01T00:00:00.000Z"

/** Minimal PersistedStore populated only with the conflict-related fields. */
function conflictStore(over: Partial<PersistedStore>): PersistedStore {
  return {
    state: emptyState(),
    dirty: {
      persons: [],
      trees: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
    },
    deviceId: "device",
    mutationIdsByBatch: [],
    nextRevision: 1,
    ...over,
  }
}

function conflict(
  conflictId: string,
  collection: PersistedConflict["collection"],
  id: string,
): PersistedConflict {
  return { conflictId, collection, id, record: {} as DirtyRecord, value: null }
}

describe("conflict lifecycle ownership", () => {
  test("reset empties all conflict state", () => {
    resetConflicts()
    expect(serializeConflicts()).toEqual({
      conflicts: [],
      clearedConflictIds: [],
      operationConflicts: [],
      clearedOperationConflictIds: [],
    })
    expect(getOperationConflicts()).toEqual([])
    expect(getSyncConflicts()).toEqual([])
  })

  test("hydrate restores conflicts and round-trips through serialize", () => {
    const operationConflict = {
      operationId: "op",
      reason: "revision-mismatch",
      retryable: true,
      records: [],
    }
    const conflicts = [conflict("c1", "persons", "p")]
    const operationConflicts = [operationConflict]
    const persisted = conflictStore({
      conflicts,
      operationConflicts,
      clearedConflictIds: ["c1"],
      clearedOperationConflictIds: ["op"],
    })

    hydrateConflicts(persisted)

    expect(serializeConflicts()).toEqual({
      conflicts,
      clearedConflictIds: ["c1"],
      operationConflicts,
      clearedOperationConflictIds: ["op"],
    })
    expect(getOperationConflicts()).toBe(operationConflicts)
    expect(getSyncConflicts()).toBe(conflicts)
  })

  test("applyPersisted replaces conflicts and cleared-operation ids but keeps cleared-conflict ids", () => {
    hydrateConflicts(conflictStore({ clearedConflictIds: ["keep"] }))
    applyPersistedConflicts(
      conflictStore({
        conflicts: [conflict("c2", "trees", "t")],
        operationConflicts: [
          {
            operationId: "op2",
            reason: "tree-member-limit",
            retryable: false,
            records: [],
          },
        ],
        clearedOperationConflictIds: ["op2"],
      }),
    )

    expect(serializeConflicts()).toEqual({
      conflicts: [conflict("c2", "trees", "t")],
      operationConflicts: [
        {
          operationId: "op2",
          reason: "tree-member-limit",
          retryable: false,
          records: [],
        },
      ],
      clearedConflictIds: ["keep"],
      clearedOperationConflictIds: ["op2"],
    })
  })
})

describe("getBlockedChangesSnapshot", () => {
  function seedBlockedMemberRemoval() {
    resetStore()
    update(
      () => ({
        ...emptyState(),
        persons: {
          jane: { id: "jane", name: "Jane", familyName: "", updatedAt: ts },
        },
      }),
      { remote: true },
    )
    const key = treeMemberKey("tree", "jane")
    const dirty: DirtyRecord = {
      action: "delete",
      revision: 1,
      blocked: true,
      operationId: "remove-jane",
      sourceId: "dev",
      changedAt: 1000,
    }
    dirtyState.treeMembers.set(key, dirty)
    hydrateConflicts(
      conflictStore({
        operationConflicts: [
          {
            operationId: "remove-jane",
            reason: "tree-member-limit",
            retryable: false,
            records: [
              {
                collection: "treeMembers",
                id: key,
                dirty: { ...dirty },
                deviceValue: undefined,
                serverValue: {
                  treeId: "tree",
                  personId: "jane",
                  revision: 5,
                  updatedAt: ts,
                  ownerId: "o",
                },
              },
            ],
          },
        ],
      }),
    )
    return key
  }

  test("overlays operation-conflict reason and device/server semantics", () => {
    seedBlockedMemberRemoval()

    expect(getBlockedChangesSnapshot("tree")).toEqual([
      {
        id: "remove-jane",
        action: "delete",
        label: "Remove Jane",
        reason: "This tree has reached its limit on members.",
        retryable: false,
        device: [{ label: "Tree membership", value: "Removed from this tree" }],
        server: [{ label: "Tree membership", value: "Member of this tree" }],
      },
    ])
  })

  test("returns the default reason when no captured operation conflict matches", () => {
    seedBlockedMemberRemoval()
    resetConflicts()

    expect(getBlockedChangesSnapshot("tree")).toEqual([
      {
        id: "remove-jane",
        action: "delete",
        label: "Remove Jane",
        reason: "This change conflicts with a newer server version.",
        retryable: true,
        device: [],
        server: [],
      },
    ])
  })

  test("caches the projection until the blocked-changes version is bumped", () => {
    seedBlockedMemberRemoval()

    const first = getBlockedChangesSnapshot("tree")
    const second = getBlockedChangesSnapshot("tree")
    expect(second).toBe(first)

    notifyListeners()
    const third = getBlockedChangesSnapshot("tree")
    expect(third).not.toBe(first)
    expect(third).toEqual(first)
  })
})
