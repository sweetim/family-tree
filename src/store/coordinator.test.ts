import { describe, expect, test } from "bun:test"
import type { PersistedPendingMutation, PersistedStore } from "./persistence"
import type { DirtyRecord } from "./state"
import {
  getDeviceId,
  getPendingMutation,
  hydrateCoordinator,
  resetCoordinator,
  serializeCoordinator,
} from "./coordinator"
import { emptyState } from "./state-internals"

function emptyDirtyRecords() {
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

function pendingMutation(): PersistedPendingMutation {
  return {
    batchKey: "batch",
    mutationId: "mutation",
    records: {
      persons: [],
      trees: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
    },
    dirty: {
      ...emptyDirtyRecords(),
      persons: [["person", { action: "upsert", revision: 1 } as DirtyRecord]],
    },
  }
}

function coordinatorStore(over: Partial<PersistedStore>): PersistedStore {
  return {
    state: emptyState(),
    dirty: emptyDirtyRecords(),
    deviceId: "device",
    mutationIdsByBatch: [],
    nextRevision: 1,
    ...over,
  }
}

describe("sync coordinator lifecycle ownership", () => {
  test("hydrate restores device and mutation coordination state", () => {
    const restoredMutation = pendingMutation()
    hydrateCoordinator(
      coordinatorStore({
        deviceId: "restored-device",
        mutationIdsByBatch: [["batch", "mutation"]],
        pendingMutation: restoredMutation,
        clearedMutationIds: ["completed-mutation"],
      }),
    )

    expect(getDeviceId()).toBe("restored-device")
    expect(getPendingMutation()).toBe(restoredMutation)
    expect(serializeCoordinator()).toEqual({
      deviceId: "restored-device",
      mutationIdsByBatch: [["batch", "mutation"]],
      pendingMutation: restoredMutation,
      clearedMutationIds: ["completed-mutation"],
    })
  })

  test("reset clears in-flight mutation coordination state", () => {
    const restoredMutation = pendingMutation()
    hydrateCoordinator(
      coordinatorStore({
        deviceId: "restored-device",
        mutationIdsByBatch: [["batch", "mutation"]],
        pendingMutation: restoredMutation,
        clearedMutationIds: ["completed-mutation"],
      }),
    )

    resetCoordinator()

    expect(getPendingMutation()).toBeUndefined()
    expect(getDeviceId()).not.toBe("restored-device")
    expect(serializeCoordinator()).toEqual({
      deviceId: getDeviceId(),
      mutationIdsByBatch: [],
      pendingMutation: undefined,
      clearedMutationIds: [],
    })
  })
})
