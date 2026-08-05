import { describe, expect, test } from "bun:test"
import {
  bumpRevision,
  clearedDirtyTokens,
  dirtyState,
  hydrateOutbox,
  replaceDirtyState,
  resetOutbox,
  serializeOutbox,
  setNextRevision,
} from "./dirty"
import type { PersistedStore } from "./persistence"
import type { DirtyRecord } from "./state"
import { emptyState } from "./state-internals"

function emptyOutboxDirty() {
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

function outboxStore(over: Partial<PersistedStore>): PersistedStore {
  return {
    state: emptyState(),
    dirty: emptyOutboxDirty(),
    deviceId: "device",
    mutationIdsByBatch: [],
    nextRevision: 1,
    ...over,
  }
}

describe("outbox lifecycle ownership", () => {
  test("reset empties the dirty map, revision counter, and cleared tokens", () => {
    bumpRevision()
    bumpRevision()
    clearedDirtyTokens.add("tok")
    dirtyState.persons.set("p", {
      action: "upsert",
      revision: 9,
    } as DirtyRecord)

    resetOutbox()

    expect(serializeOutbox()).toEqual({
      dirty: emptyOutboxDirty(),
      nextRevision: 1,
      clearedDirtyTokens: [],
    })
    expect([...clearedDirtyTokens]).toEqual([])
  })

  test("bumpRevision returns and increments the counter", () => {
    resetOutbox()
    expect(bumpRevision()).toBe(1)
    expect(bumpRevision()).toBe(2)
  })

  test("hydrate restores dirty records, revision, and cleared tokens", () => {
    const record: DirtyRecord = { action: "upsert", revision: 5 }
    hydrateOutbox(
      outboxStore({
        dirty: { ...emptyOutboxDirty(), persons: [["p", record]] },
        nextRevision: 7,
        clearedDirtyTokens: ["tok"],
      }),
    )

    expect(serializeOutbox().nextRevision).toBe(7)
    expect(serializeOutbox().clearedDirtyTokens).toEqual(["tok"])
    expect([...serializeOutbox().dirty.persons]).toEqual([["p", record]])
  })

  test("replaceDirtyState and setNextRevision reassign directly", () => {
    const record: DirtyRecord = { action: "delete", revision: 3 }
    hydrateOutbox(
      outboxStore({
        dirty: { ...emptyOutboxDirty(), trees: [["t", record]] },
      }),
    )
    const captured = dirtyState

    resetOutbox()
    replaceDirtyState(captured)
    setNextRevision(99)

    expect([...dirtyState.trees.keys()]).toEqual(["t"])
    expect(serializeOutbox().nextRevision).toBe(99)
  })
})
