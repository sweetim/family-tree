import { describe, expect, test } from "bun:test"
import type { DirtyState, GlobalState } from "./store"
import type {
  SyncAppliedIds,
  SyncPullResponse,
  SyncRecordSet,
} from "./sync/types"
import { projectTree } from "./types"

const timestamp = "2024-01-01T00:00:00.000Z"

function emptyState(): GlobalState {
  return {
    persons: {},
    index: [],
    treeMembers: {},
    unions: {},
    unionEvents: {},
    treeUnions: {},
    parentChildRelationships: {},
    treeParentChildRelationships: {},
  }
}

function relationshipState(): GlobalState {
  return {
    persons: {
      tim: { id: "tim", name: "Tim", updatedAt: timestamp },
      yumi: { id: "yumi", name: "Yumi", updatedAt: timestamp },
      kid: { id: "kid", name: "Kid", updatedAt: timestamp },
    },
    index: [
      { id: "a", name: "A", createdAt: timestamp, updatedAt: timestamp },
      { id: "b", name: "B", createdAt: timestamp, updatedAt: timestamp },
      {
        id: "viewer",
        name: "Viewer",
        role: "viewer",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    treeMembers: Object.fromEntries(
      ["a", "b", "viewer"].flatMap((treeId) =>
        ["tim", "yumi", "kid"].map((personId) => [
          JSON.stringify([treeId, personId]),
          { treeId, personId, createdAt: timestamp, updatedAt: timestamp },
        ]),
      ),
    ),
    unions: {
      union: {
        id: "union",
        firstPersonId: "tim",
        secondPersonId: "yumi",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    unionEvents: {
      event: {
        id: "event",
        unionId: "union",
        type: "married",
        eventDate: "2020-01-01",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    treeUnions: {
      '["a","union"]': {
        treeId: "a",
        unionId: "union",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      '["b","union"]': {
        treeId: "b",
        unionId: "union",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    parentChildRelationships: {
      parent: {
        id: "parent",
        parentPersonId: "tim",
        childPersonId: "kid",
        type: "biological",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    treeParentChildRelationships: {
      '["a","parent"]': {
        treeId: "a",
        parentChildRelationshipId: "parent",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      '["b","parent"]': {
        treeId: "b",
        parentChildRelationshipId: "parent",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  }
}

function marriageEvent(state: GlobalState) {
  const event = state.unionEvents.event
  if (!event) throw new Error("Missing marriage event fixture")
  return event
}

function fullPull(
  own: Partial<SyncRecordSet> = {},
  shared: SyncPullResponse["shared"] = [],
): SyncPullResponse {
  return {
    own: {
      persons: [],
      trees: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
      ...own,
    },
    shared,
    serverTime: timestamp,
  }
}

function emptyAppliedIds(): SyncAppliedIds {
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

function deferred<Value>() {
  let resolvePromise: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function freshStore() {
  const store = await import("./store")
  store.resetStore()
  return store
}

describe("legacy projected JSON compatibility", () => {
  test("normalizes v1 and retains the projected v2 format", async () => {
    const { normalizeImport } = await import("./store")
    const versionOne = {
      a: { id: "a", name: "A", parentIds: ["p"], spouseId: "b" },
      b: { id: "b", name: "B" },
      p: { id: "p", name: "P" },
    }
    expect(normalizeImport(versionOne).a?.parents).toEqual([{ id: "p" }])
    expect(normalizeImport(versionOne).a?.spouseIds).toEqual(["b"])

    const versionTwo = {
      a: {
        id: "a",
        name: "A",
        parents: [{ id: "p", type: "foster" as const }],
        spouseIds: ["b"],
        marriageDates: { b: "2020-01-01" },
      },
      b: {
        id: "b",
        name: "B",
        parents: [],
        spouseIds: [],
        marriageDates: {},
      },
      p: {
        id: "p",
        name: "P",
        parents: [],
        spouseIds: [],
        marriageDates: {},
      },
    }
    expect(normalizeImport(versionTwo)).toEqual(versionTwo)
  })

  test("sample data remains a projected seed with all relationships", async () => {
    const { seedData } = await import("./store")
    const seed = seedData()
    expect(Object.keys(seed.people)).toHaveLength(5)
    expect(
      Object.values(seed.people).some((person) => person.spouseIds.length),
    ).toBe(true)
    expect(
      Object.values(seed.people).filter((person) => person.parents.length),
    ).toHaveLength(2)
  })

  test("rejects malformed ids, dates, references, parent data, and cycles", async () => {
    const store = await freshStore()
    const validPerson = {
      id: "a",
      name: "A",
      parents: [],
      spouseIds: [],
      marriageDates: {},
    }
    const invalidImports: Record<string, unknown>[] = [
      { é: { ...validPerson, id: "é" } },
      { a: { ...validPerson, id: "different" } },
      {
        a: {
          ...validPerson,
          spouseIds: ["b"],
          marriageDates: { b: "2023-02-29" },
        },
        b: { ...validPerson, id: "b" },
      },
      {
        a: {
          ...validPerson,
          parents: [{ id: "b", type: "unknown" }],
        },
        b: { ...validPerson, id: "b" },
      },
      {
        a: {
          ...validPerson,
          parents: [{ id: "b", adopted: "yes" }],
        },
        b: { ...validPerson, id: "b" },
      },
      { a: { ...validPerson, spouseIds: ["missing"] } },
      { a: { ...validPerson, spouseIds: ["a"] } },
      {
        a: {
          ...validPerson,
          parents: [{ id: "b" }, { id: "c" }, { id: "d" }],
        },
        b: { ...validPerson, id: "b" },
        c: { ...validPerson, id: "c" },
        d: { ...validPerson, id: "d" },
      },
      {
        a: { ...validPerson, parents: [{ id: "b" }] },
        b: { ...validPerson, id: "b", parents: [{ id: "a" }] },
      },
    ]

    for (const invalidImport of invalidImports) {
      expect(() => store.normalizeImport(invalidImport)).toThrow()
    }
    expect(store.getSnapshot()).toEqual(emptyState())
    expect(
      Object.values(store.snapshotDirty()).every(
        (records) => records.size === 0,
      ),
    ).toBe(true)
  })
})

describe("normalized relationship mutations", () => {
  test("link reuses one current union and skips viewer-only trees", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    previous.unions = {}
    previous.unionEvents = {}
    previous.treeUnions = {}

    const next = store.linkSpouseRecords(
      previous,
      ["a", "b", "viewer"],
      "yumi",
      "tim",
    )
    const union = Object.values(next.unions)[0]
    expect(Object.keys(next.unions)).toHaveLength(1)
    expect(union?.firstPersonId).toBe("tim")
    expect(union?.secondPersonId).toBe("yumi")
    expect(Object.values(next.unionEvents).map((event) => event.type)).toEqual([
      "married",
    ])
    expect(
      next.treeUnions[store.treeUnionKey("a", union?.id ?? "")],
    ).toBeTruthy()
    expect(
      next.treeUnions[store.treeUnionKey("b", union?.id ?? "")],
    ).toBeTruthy()
    expect(
      next.treeUnions[store.treeUnionKey("viewer", union?.id ?? "")],
    ).toBeUndefined()
  })

  test("unlink removes one tree association, not the canonical union", async () => {
    const store = await freshStore()
    const next = store.unlinkSpouseRecords(
      relationshipState(),
      "a",
      "tim",
      "yumi",
    )

    expect(next.unions.union).toBeTruthy()
    expect(next.unionEvents.event).toBeTruthy()
    expect(next.treeUnions['["a","union"]']).toBeUndefined()
    expect(next.treeUnions['["b","union"]']).toBeTruthy()
  })

  test("marriage date edits one event visible in every associated tree", async () => {
    const store = await freshStore()
    const next = store.updateSpouseDateRecords(
      relationshipState(),
      "a",
      "tim",
      "yumi",
      "2025-06-20",
    )

    expect(projectTree(next.persons, next, "a").tim?.marriageDates.yumi).toBe(
      "2025-06-20",
    )
    expect(projectTree(next.persons, next, "b").tim?.marriageDates.yumi).toBe(
      "2025-06-20",
    )
  })

  test("parent unlink is tree-local while adopted edits are global", async () => {
    const store = await freshStore()
    const removed = store.removeParentRecords(
      relationshipState(),
      "a",
      "kid",
      "tim",
    )
    expect(removed.parentChildRelationships.parent).toBeTruthy()
    expect(projectTree(removed.persons, removed, "a").kid?.parents).toEqual([])
    expect(projectTree(removed.persons, removed, "b").kid?.parents).toEqual([
      { id: "tim", adopted: undefined, type: "biological" },
    ])

    const adopted = store.setParentAdoptedRecords(
      relationshipState(),
      "a",
      "kid",
      "tim",
      true,
    )
    expect(
      projectTree(adopted.persons, adopted, "a").kid?.parents[0]?.adopted,
    ).toBe(true)
    expect(
      projectTree(adopted.persons, adopted, "b").kid?.parents[0]?.adopted,
    ).toBe(true)
  })

  test("remove-from-tree keeps canonical facts and other associations", async () => {
    const store = await freshStore()
    const next = store.removeFromTreeRecords(relationshipState(), "tim", "a")

    expect(next.treeMembers['["a","tim"]']).toBeUndefined()
    expect(next.treeUnions['["a","union"]']).toBeUndefined()
    expect(next.treeParentChildRelationships['["a","parent"]']).toBeUndefined()
    expect(next.unions.union).toBeTruthy()
    expect(next.parentChildRelationships.parent).toBeTruthy()
    expect(next.treeMembers['["b","tim"]']).toBeTruthy()
    expect(next.treeUnions['["b","union"]']).toBeTruthy()
  })

  test("merge replaces writable associations without mutating canonical endpoints", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    previous.persons.alias = { id: "alias", name: "Alias" }
    previous.persons.other = { id: "other", name: "Other" }
    previous.treeMembers['["b","alias"]'] = {
      treeId: "b",
      personId: "alias",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    previous.treeMembers['["viewer","alias"]'] = {
      treeId: "viewer",
      personId: "alias",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    previous.treeMembers['["b","other"]'] = {
      treeId: "b",
      personId: "other",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    previous.treeMembers['["viewer","other"]'] = {
      treeId: "viewer",
      personId: "other",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    previous.unions.aliasUnion = {
      id: "aliasUnion",
      firstPersonId: "alias",
      secondPersonId: "other",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    previous.unionEvents.aliasEvent = {
      id: "aliasEvent",
      unionId: "aliasUnion",
      type: "married",
      eventDate: "2010-04-03",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    for (const treeId of ["b", "viewer"]) {
      previous.treeUnions[JSON.stringify([treeId, "aliasUnion"])] = {
        treeId,
        unionId: "aliasUnion",
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    }
    previous.parentChildRelationships.aliasParent = {
      id: "aliasParent",
      parentPersonId: "alias",
      childPersonId: "other",
      type: "foster",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    for (const treeId of ["b", "viewer"]) {
      previous.treeParentChildRelationships[
        JSON.stringify([treeId, "aliasParent"])
      ] = {
        treeId,
        parentChildRelationshipId: "aliasParent",
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    }

    const next = store.mergePersonRecords(previous, "tim", "alias")
    expect(next.persons.alias).toBeUndefined()
    expect(next.treeMembers['["b","tim"]']).toBeTruthy()
    expect(next.treeMembers['["b","alias"]']).toBeUndefined()
    expect(next.treeMembers['["viewer","alias"]']).toBeTruthy()
    expect(next.unions.aliasUnion).toEqual(previous.unions.aliasUnion)
    expect(next.parentChildRelationships.aliasParent).toEqual(
      previous.parentChildRelationships.aliasParent,
    )
    expect(next.treeUnions['["viewer","aliasUnion"]']).toBeTruthy()
    expect(
      next.treeParentChildRelationships['["viewer","aliasParent"]'],
    ).toBeTruthy()

    const replacementUnion = Object.values(next.unions).find(
      (union) =>
        union.firstPersonId === "other" && union.secondPersonId === "tim",
    )
    expect(replacementUnion).toBeTruthy()
    expect(
      Object.values(next.unionEvents).find(
        (event) => event.unionId === replacementUnion?.id,
      )?.eventDate,
    ).toBe("2010-04-03")
    const replacementParent = Object.values(next.parentChildRelationships).find(
      (relationship) =>
        relationship.parentPersonId === "tim"
        && relationship.childPersonId === "other",
    )
    expect(replacementParent?.type).toBe("foster")

    const stamped = store.stampAndEnqueue(previous, next)
    const request = store.buildPushWires(
      stamped,
      store.snapshotDirty(),
      "2026-01-01T00:00:00.000Z",
    )
    expect(request.unions.some((wire) => wire.id === "aliasUnion")).toBe(false)
    expect(request.unionEvents.some((wire) => wire.id === "aliasEvent")).toBe(
      false,
    )
    expect(
      request.parentChildRelationships.some(
        (wire) => wire.id === "aliasParent",
      ),
    ).toBe(false)
    expect(request.unions.some((wire) => "deletedAt" in wire)).toBe(false)
    expect(
      request.parentChildRelationships.some((wire) => "deletedAt" in wire),
    ).toBe(false)
  })

  test("person delete emits association tombstones but no global fact deletes", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    const next = store.deletePersonRecords(previous, "tim")
    expect(next.unions.union).toBeTruthy()
    expect(next.unionEvents.event).toBeTruthy()
    expect(next.parentChildRelationships.parent).toBeTruthy()

    const stamped = store.stampAndEnqueue(previous, next)
    const request = store.buildPushWires(
      stamped,
      store.snapshotDirty(),
      "2026-01-01T00:00:00.000Z",
    )
    expect(request.persons[0]).toMatchObject({ id: "tim" })
    expect(request.treeMembers.length).toBeGreaterThan(0)
    expect(request.treeUnions.length).toBeGreaterThan(0)
    expect(request.treeParentChildRelationships.length).toBeGreaterThan(0)
    expect(request.unions).toEqual([])
    expect(request.unionEvents).toEqual([])
    expect(request.parentChildRelationships).toEqual([])
  })

  test("global parent facts enforce cycle and two-parent limits", async () => {
    const store = await freshStore()
    const graph = relationshipState()
    graph.persons.third = { id: "third", name: "Third" }
    graph.parentChildRelationships.second = {
      id: "second",
      parentPersonId: "yumi",
      childPersonId: "kid",
      type: "biological",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    expect(store.canCreateParentRelationship(graph, "third", "kid")).toBe(false)
    expect(store.canCreateParentRelationship(graph, "kid", "tim")).toBe(false)
  })

  test("merge rejects a keep person visible only through viewer trees", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    previous.persons.alias = { id: "alias", name: "Alias" }
    for (const [key, membership] of Object.entries(previous.treeMembers)) {
      if (membership.personId === "tim" && membership.treeId !== "viewer") {
        delete previous.treeMembers[key]
      }
    }

    expect(store.personHasWritableTree(previous, "tim")).toBe(false)
    expect(store.mergePersonRecords(previous, "tim", "alias")).toBe(previous)
  })
})

describe("remote merge", () => {
  test("merges normalized records independently and applies tombstones", async () => {
    const store = await freshStore()
    store.applyRemote({
      persons: [{ id: "tim", name: "Tim", updatedAt: timestamp }],
      trees: [
        {
          id: "a",
          name: "A",
          createdAt: timestamp,
          updatedAt: timestamp,
          ownerId: "owner",
        },
      ],
      treeMembers: [
        {
          treeId: "a",
          personId: "tim",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    expect(store.getSnapshot().treeMembers['["a","tim"]']).toBeTruthy()
    expect(store.countMembers("a")).toBe(1)

    store.applyRemote({
      treeMembers: [
        {
          treeId: "a",
          personId: "tim",
          updatedAt: "2025-01-01T00:00:00.000Z",
          deletedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    })
    expect(store.getSnapshot().treeMembers['["a","tim"]']).toBeUndefined()
    expect(store.countMembers("a")).toBe(0)
  })

  test("older remote records lose and remote merges do not become dirty", async () => {
    const store = await freshStore()
    store.applyRemote({
      persons: [{ id: "tim", name: "Fresh", updatedAt: timestamp }],
    })
    store.applyRemote({
      persons: [
        { id: "tim", name: "Stale", updatedAt: "2023-01-01T00:00:00.000Z" },
      ],
    })
    expect(store.getSnapshot().persons.tim?.name).toBe("Fresh")
    expect([...store.snapshotDirty().persons]).toEqual([])
  })

  test("tombstone clocks prevent delayed resurrection in every collection", async () => {
    const store = await freshStore()
    const deletedAt = "2025-01-01T00:00:00.000Z"
    const staleAt = "2024-01-01T00:00:00.000Z"
    store.applyRemote({
      persons: [{ id: "person", updatedAt: deletedAt, deletedAt }],
      trees: [{ id: "tree", updatedAt: deletedAt, deletedAt }],
      treeMembers: [
        {
          treeId: "tree",
          personId: "person",
          updatedAt: deletedAt,
          deletedAt,
        },
      ],
      unions: [{ id: "union", updatedAt: deletedAt, deletedAt }],
      unionEvents: [{ id: "event", updatedAt: deletedAt, deletedAt }],
      treeUnions: [
        { treeId: "tree", unionId: "union", updatedAt: deletedAt, deletedAt },
      ],
      parentChildRelationships: [
        { id: "parent", updatedAt: deletedAt, deletedAt },
      ],
      treeParentChildRelationships: [
        {
          treeId: "tree",
          parentChildRelationshipId: "parent",
          updatedAt: deletedAt,
          deletedAt,
        },
      ],
    })
    store.applyRemote({
      persons: [{ id: "person", name: "Stale", updatedAt: staleAt }],
      trees: [
        {
          id: "tree",
          name: "Stale",
          ownerId: "owner",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      treeMembers: [
        {
          treeId: "tree",
          personId: "person",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      unions: [
        {
          id: "union",
          firstPersonId: "first",
          secondPersonId: "second",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      unionEvents: [
        {
          id: "event",
          unionId: "union",
          type: "married",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      treeUnions: [
        {
          treeId: "tree",
          unionId: "union",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      parentChildRelationships: [
        {
          id: "parent",
          parentPersonId: "first",
          childPersonId: "second",
          type: "biological",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
      treeParentChildRelationships: [
        {
          treeId: "tree",
          parentChildRelationshipId: "parent",
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ],
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.persons).toEqual({})
    expect(snapshot.index).toEqual([])
    expect(snapshot.treeMembers).toEqual({})
    expect(snapshot.unions).toEqual({})
    expect(snapshot.unionEvents).toEqual({})
    expect(snapshot.treeUnions).toEqual({})
    expect(snapshot.parentChildRelationships).toEqual({})
    expect(snapshot.treeParentChildRelationships).toEqual({})

    store.resetStore()
    store.applyRemote({
      persons: [{ id: "person", name: "After reset", updatedAt: staleAt }],
    })
    expect(store.getSnapshot().persons.person?.name).toBe("After reset")
  })

  test("access metadata updates without a tree timestamp change", async () => {
    const store = await freshStore()
    store.applyRemote({
      trees: [
        {
          id: "tree",
          name: "Tree",
          ownerId: "owner",
          ownerEmail: "old@example.com",
          role: "viewer",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    store.applyRemote({
      trees: [
        {
          id: "tree",
          name: "Tree",
          ownerId: "owner",
          ownerEmail: "new@example.com",
          role: "editor",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    expect(store.getSnapshot().index[0]?.role).toBe("editor")
    expect(store.getSnapshot().index[0]?.ownerEmail).toBe("new@example.com")
  })

  test("authoritative full pulls remove revoked shared trees", async () => {
    const store = await freshStore()
    const sharedTree = {
      tree: {
        id: "shared",
        name: "Shared",
        ownerId: "other",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      role: "viewer" as const,
      ownerEmail: "owner@example.com",
      persons: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
    }
    store.applyFullPull(fullPull({}, [sharedTree]))
    expect(store.getSnapshot().index.map((tree) => tree.id)).toEqual(["shared"])

    store.applyFullPull(fullPull())
    expect(store.getSnapshot().index).toEqual([])
    store.applyRemote({
      trees: [
        {
          id: "shared",
          name: "Delayed stale share",
          ownerId: "other",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    })
    expect(store.getSnapshot().index).toEqual([])
  })

  test("authoritative pulls clear old clocks for active records and clock omissions", async () => {
    const store = await freshStore()
    store.applyRemote({
      persons: [
        {
          id: "reauthorized",
          updatedAt: "2025-01-01T00:00:00.000Z",
          deletedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "still-deleted",
          updatedAt: "2025-01-01T00:00:00.000Z",
          deletedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "omitted",
          name: "Previously visible",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    })
    const pull = fullPull({
      persons: [
        {
          id: "reauthorized",
          name: "Visible again",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    })
    pull.serverTime = "2026-01-01T00:00:00.000Z"
    store.applyFullPull(pull)

    expect(store.getSnapshot().persons.reauthorized?.name).toBe("Visible again")
    store.applyRemote({
      persons: [
        {
          id: "omitted",
          name: "Delayed stale record",
          updatedAt: "2025-06-01T00:00:00.000Z",
        },
        {
          id: "still-deleted",
          name: "Delayed deleted record",
          updatedAt: "2025-06-01T00:00:00.000Z",
        },
      ],
    })
    expect(store.getSnapshot().persons.omitted).toBeUndefined()
    expect(store.getSnapshot().persons["still-deleted"]).toBeUndefined()
  })
})

describe("dirty tracking and push wires", () => {
  test("relationship changes stamp only that normalized record", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    const next = {
      ...previous,
      unionEvents: {
        ...previous.unionEvents,
        event: { ...marriageEvent(previous), eventDate: "2025-01-01" },
      },
    }
    const stamped = store.stampAndEnqueue(previous, next)

    expect(stamped.unionEvents.event?.updatedAt).not.toBe(timestamp)
    expect([...store.snapshotDirty().unionEvents.keys()]).toEqual(["event"])
    expect([...store.snapshotDirty().trees.keys()]).toEqual([])
  })

  test("an applied response cannot clear a newer edit of the same id", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    const first = store.stampAndEnqueue(previous, {
      ...previous,
      unionEvents: {
        ...previous.unionEvents,
        event: { ...marriageEvent(previous), eventDate: "2025-01-01" },
      },
    })
    const shipped = store.snapshotDirty()
    store.stampAndEnqueue(first, {
      ...first,
      unionEvents: {
        ...first.unionEvents,
        event: { ...marriageEvent(first), eventDate: "2026-01-01" },
      },
    })

    store.clearDirty({ unionEvents: ["event"] }, shipped)
    expect([...store.snapshotDirty().unionEvents.keys()]).toEqual(["event"])
  })

  test("skipped records are cleared and reconciled by an authoritative pull", async () => {
    const store = await freshStore()
    store.stampAndEnqueue(emptyState(), {
      ...emptyState(),
      persons: { local: { id: "local", name: "Optimistic" } },
    })
    const pull = fullPull({
      persons: [{ id: "server", name: "Authoritative", updatedAt: timestamp }],
    })
    const originalFetch = globalThis.fetch
    let requestCount = 0
    globalThis.fetch = (async (_input, init) => {
      requestCount++
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            applied: emptyAppliedIds(),
            skipped: { ...emptyAppliedIds(), persons: ["local"] },
            serverTime: timestamp,
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(pull), { status: 200 })
    }) as typeof fetch

    try {
      await store.syncPendingChanges()
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requestCount).toBe(2)
    expect(store.getSnapshot().persons).toEqual({
      server: {
        id: "server",
        name: "Authoritative",
        updatedAt: timestamp,
        dob: undefined,
        dod: undefined,
        gender: undefined,
        location: undefined,
        photo: undefined,
        ownerId: undefined,
      },
    })
    expect([...store.snapshotDirty().persons]).toEqual([])
  })

  test("a new edit during reconciliation discards the in-flight pull", async () => {
    const store = await freshStore()
    store.stampAndEnqueue(emptyState(), {
      ...emptyState(),
      persons: { first: { id: "first", name: "First edit" } },
    })
    const firstPullRequested = deferred<void>()
    const firstPullResponse = deferred<SyncPullResponse>()
    const stalePull = fullPull({
      persons: [{ id: "stale", name: "Stale pull", updatedAt: timestamp }],
    })
    const finalPull = fullPull({
      persons: [{ id: "final", name: "Final pull", updatedAt: timestamp }],
    })
    const originalFetch = globalThis.fetch
    let postCount = 0
    let pullCount = 0
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === "POST") {
        postCount++
        if (postCount === 1) {
          return new Response(
            JSON.stringify({
              applied: emptyAppliedIds(),
              skipped: { ...emptyAppliedIds(), persons: ["first"] },
              serverTime: timestamp,
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            applied: { ...emptyAppliedIds(), persons: ["second"] },
            skipped: emptyAppliedIds(),
            serverTime: timestamp,
          }),
          { status: 200 },
        )
      }
      pullCount++
      if (pullCount === 1) {
        firstPullRequested.resolve()
        return new Response(JSON.stringify(await firstPullResponse.promise), {
          status: 200,
        })
      }
      return new Response(JSON.stringify(finalPull), { status: 200 })
    }) as typeof fetch

    try {
      const synchronization = store.syncPendingChanges()
      await firstPullRequested.promise
      store.stampAndEnqueue(emptyState(), {
        ...emptyState(),
        persons: { second: { id: "second", name: "Second edit" } },
      })
      firstPullResponse.resolve(stalePull)
      await synchronization
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(postCount).toBe(2)
    expect(pullCount).toBe(2)
    expect(store.getSnapshot().persons.stale).toBeUndefined()
    expect(store.getSnapshot().persons.final?.name).toBe("Final pull")
  })

  test("builds normalized tombstones and includes every collection", async () => {
    const store = await freshStore()
    const dirty: DirtyState = store.snapshotDirty()
    dirty.trees.set("a", { action: "delete", revision: 1 })
    dirty.treeMembers.set(store.treeMemberKey("a", "tim"), {
      action: "delete",
      revision: 2,
    })
    dirty.treeUnions.set(store.treeUnionKey("a", "union"), {
      action: "delete",
      revision: 3,
    })
    dirty.treeParentChildRelationships.set(
      store.treeParentChildRelationshipKey("a", "parent"),
      { action: "delete", revision: 4 },
    )

    const request = store.buildPushWires(
      emptyState(),
      dirty,
      "2025-07-25T00:00:00.000Z",
    )
    expect(request.trees[0]).toEqual({
      id: "a",
      updatedAt: "2025-07-25T00:00:00.000Z",
      deletedAt: "2025-07-25T00:00:00.000Z",
    })
    expect(request.treeMembers[0]).toMatchObject({
      treeId: "a",
      personId: "tim",
      deletedAt: "2025-07-25T00:00:00.000Z",
    })
    expect(request.treeUnions[0]).toMatchObject({
      treeId: "a",
      unionId: "union",
    })
    expect(request.treeParentChildRelationships[0]).toMatchObject({
      treeId: "a",
      parentChildRelationshipId: "parent",
    })
    expect(Object.keys(request).sort()).toEqual([
      "parentChildRelationships",
      "persons",
      "treeMembers",
      "treeParentChildRelationships",
      "treeUnions",
      "trees",
      "unionEvents",
      "unions",
    ])
  })
})
