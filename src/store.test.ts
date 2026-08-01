import { describe, expect, test } from "bun:test"
import { type DirtyState, findAncestorTree, type GlobalState } from "./store"
import { update } from "./store/state"
import type {
  SyncPullResponse,
  SyncRecordSet,
  TreeSnapshotResponse,
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

describe("findAncestorTree", () => {
  function member(treeId: string, personId: string) {
    return [
      JSON.stringify([treeId, personId]),
      { treeId, personId, createdAt: timestamp, updatedAt: timestamp },
    ]
  }

  function stateWithAncestor(): GlobalState {
    return {
      persons: {
        c: { id: "c", name: "Child", updatedAt: timestamp },
        p: { id: "p", name: "Parent", updatedAt: timestamp },
      },
      index: [
        {
          id: "root",
          name: "Root",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "ancestor",
          name: "Ancestor",
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: timestamp,
        },
        {
          id: "other",
          name: "Other",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      treeMembers: Object.fromEntries([
        member("root", "c"),
        member("ancestor", "c"),
        member("ancestor", "p"),
        member("other", "c"),
      ]),
      unions: {},
      unionEvents: {},
      treeUnions: {},
      parentChildRelationships: {
        pc: {
          id: "pc",
          parentPersonId: "p",
          childPersonId: "c",
          type: "biological",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      treeParentChildRelationships: {},
    }
  }

  test("returns the other tree that holds the person and a parent", () => {
    expect(findAncestorTree(stateWithAncestor(), "c", "root")?.id).toBe(
      "ancestor",
    )
  })

  test("returns undefined when no other tree has a parent", () => {
    expect(
      findAncestorTree(stateWithAncestor(), "c", "ancestor"),
    ).toBeUndefined()
  })

  test("returns undefined when the person has no parents", () => {
    expect(findAncestorTree(stateWithAncestor(), "p", "root")).toBeUndefined()
  })

  test("picks the earliest candidate deterministically", () => {
    const state = stateWithAncestor()
    state.index.push({
      id: "ancestor2",
      name: "Ancestor2",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    state.treeMembers[JSON.stringify(["ancestor2", "c"])] = {
      treeId: "ancestor2",
      personId: "c",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    state.treeMembers[JSON.stringify(["ancestor2", "p"])] = {
      treeId: "ancestor2",
      personId: "p",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    expect(findAncestorTree(state, "c", "root")?.id).toBe("ancestor")
  })
})

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

describe("projected JSON compatibility", () => {
  test("retains the projected v2 format", async () => {
    const { normalizeImport } = await import("./store")
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
  test("adding an existing member to a tree includes their current spouse", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    delete previous.treeMembers['["b","tim"]']
    delete previous.treeMembers['["b","yumi"]']
    delete previous.treeUnions['["b","union"]']

    const next = store.addMemberWithSpousesRecords(previous, "b", "yumi")

    expect(next.treeMembers['["b","yumi"]']).toBeTruthy()
    expect(next.treeMembers['["b","tim"]']).toBeTruthy()
    expect(next.treeUnions['["b","union"]']).toBeTruthy()
    expect(projectTree(next.persons, next, "b").yumi?.spouseIds).toEqual([
      "tim",
    ])
  })

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

  test("marking divorce records a divorced event and drops the couple from spouseIds", async () => {
    const store = await freshStore()
    const next = store.markDivorcedRecords(
      relationshipState(),
      "a",
      "tim",
      "yumi",
      true,
      "2024-05-01",
    )

    const divorced = Object.values(next.unionEvents).find(
      (event) => event.type === "divorced",
    )
    expect(divorced?.unionId).toBe("union")
    expect(divorced?.eventDate).toBe("2024-05-01")
    // Divorce is terminal, so the couple leaves spouseIds...
    expect(projectTree(next.persons, next, "a").tim?.spouseIds).toEqual([])
    // ...but stays editable through unionStatus, and the child is unaffected.
    expect(projectTree(next.persons, next, "a").tim?.unionStatus?.yumi).toEqual(
      {
        type: "divorced",
        marriageDate: "2020-01-01",
        date: "2024-05-01",
      },
    )
    expect(projectTree(next.persons, next, "a").kid?.parents).toEqual([
      { id: "tim", adopted: undefined, type: "biological" },
    ])
  })

  test("re-divorcing updates the existing event date instead of stacking", async () => {
    const store = await freshStore()
    const first = store.markDivorcedRecords(
      relationshipState(),
      "a",
      "tim",
      "yumi",
      true,
      "2024-05-01",
    )
    const second = store.markDivorcedRecords(
      first,
      "a",
      "tim",
      "yumi",
      true,
      "2024-09-09",
    )

    const divorcedEvents = Object.values(second.unionEvents).filter(
      (event) => event.type === "divorced",
    )
    expect(divorcedEvents).toHaveLength(1)
    expect(divorcedEvents[0]?.eventDate).toBe("2024-09-09")
  })

  test("reconciling records a reconciled event and restores the marriage", async () => {
    const store = await freshStore()
    const divorced = store.markDivorcedRecords(
      relationshipState(),
      "a",
      "tim",
      "yumi",
      true,
    )
    const reconciled = store.markDivorcedRecords(
      divorced,
      "a",
      "tim",
      "yumi",
      false,
    )

    expect(
      Object.values(reconciled.unionEvents).some(
        (event) => event.type === "reconciled",
      ),
    ).toBe(true)
    expect(
      projectTree(reconciled.persons, reconciled, "a").tim?.spouseIds,
    ).toEqual(["yumi"])
    expect(
      projectTree(reconciled.persons, reconciled, "a").tim?.unionStatus?.yumi
        ?.type,
    ).toBe("reconciled")
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
    graph.treeParentChildRelationships['["a","second"]'] = {
      treeId: "a",
      parentChildRelationshipId: "second",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    expect(store.canCreateParentRelationship(graph, "third", "kid")).toBe(false)
    expect(store.canCreateParentRelationship(graph, "kid", "tim")).toBe(false)
  })

  test("orphaned parent facts do not count toward the two-parent limit", async () => {
    const store = await freshStore()
    const graph = relationshipState()
    graph.persons.fifth = { id: "fifth", name: "Fifth", updatedAt: timestamp }
    graph.parentChildRelationships.orphan = {
      id: "orphan",
      parentPersonId: "yumi",
      childPersonId: "kid",
      type: "biological",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    expect(store.canCreateParentRelationship(graph, "fifth", "kid")).toBe(true)
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

  test("lazy manifest refresh preserves a pending tree rename", async () => {
    const store = await freshStore()
    store.applyFullPull(
      fullPull({
        trees: [
          {
            id: "tree",
            name: "Original",
            ownerId: "owner",
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: 1,
          },
        ],
      }),
    )
    const response = deferred<Response>()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => response.promise) as unknown as typeof fetch
    try {
      update((previous) => ({
        ...previous,
        index: previous.index.map((tree) =>
          tree.id === "tree" ? { ...tree, name: "Pending" } : tree,
        ),
      }))
      await Promise.resolve()
      store.applyTreeManifest([
        {
          id: "tree",
          name: "Remote",
          ownerId: "owner",
          role: "owner",
          memberCount: 1,
          syncVersion: 2,
          createdAt: timestamp,
          updatedAt: "2025-01-01T00:00:00.000Z",
          revision: 2,
        },
      ])
      expect(store.getSnapshot().index[0]?.name).toBe("Pending")
      expect(store.snapshotDirty().trees.has("tree")).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("partial graph snapshots merge without pruning omitted records", async () => {
    const store = await freshStore()
    store.applyRemote({
      trees: [
        {
          id: "tree",
          name: "Tree",
          ownerId: "owner",
          role: "owner",
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
        },
      ],
      persons: [
        { id: "visible", name: "Visible", updatedAt: timestamp, revision: 1 },
        { id: "outside", name: "Outside", updatedAt: timestamp, revision: 1 },
      ],
      treeMembers: [
        {
          treeId: "tree",
          personId: "visible",
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
        },
        {
          treeId: "tree",
          personId: "outside",
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
        },
      ],
    })
    store.applyTreeSnapshot({
      tree: {
        id: "tree",
        name: "Tree",
        ownerId: "owner",
        role: "owner",
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      },
      records: {
        persons: [],
        treeMembers: [],
        unions: [],
        unionEvents: [],
        treeUnions: [],
        parentChildRelationships: [],
        treeParentChildRelationships: [],
      },
      syncVersion: 1,
      cursor: "cursor",
      partial: true,
    })

    expect(store.countMembers("tree")).toBe(2)
    expect(store.getSnapshot().index[0]?.loaded).toBe(false)
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

  test("a pending delete survives a concurrent full pull without resurrecting", async () => {
    const store = await freshStore()
    const activePull = () =>
      fullPull({
        persons: [
          { id: "tim", name: "Tim", updatedAt: timestamp, ownerId: "owner" },
        ],
        trees: [
          {
            id: "a",
            name: "A",
            createdAt: timestamp,
            revision: 1,
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

    // Hold the optimistic push in flight so its tombstone never reaches server.
    const pushResponse = deferred<Response>()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, _init) =>
      pushResponse.promise) as typeof fetch

    try {
      store.applyFullPull(activePull())
      expect(store.getSnapshot().persons.tim).toBeTruthy()

      update((previous) => store.deletePersonRecords(previous, "tim"))
      await Promise.resolve()
      expect(store.getSnapshot().persons.tim).toBeUndefined()
      expect([...store.snapshotDirty().persons.keys()]).toEqual(["tim"])

      // A pull that still reports tim active (server read before the delete
      // committed) must not bring tim, or its membership, back to life.
      store.applyFullPull(activePull())

      expect(store.getSnapshot().persons.tim).toBeUndefined()
      expect(
        store.getSnapshot().treeMembers[store.treeMemberKey("a", "tim")],
      ).toBeUndefined()
      expect([...store.snapshotDirty().persons.keys()]).toContain("tim")
      expect([...store.snapshotDirty().treeMembers.keys()]).toContain(
        store.treeMemberKey("a", "tim"),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("a pending upsert survives reconciliation and adopts the server revision", async () => {
    const store = await freshStore()
    const serverPull = (revision: number, name: string) =>
      fullPull({
        persons: [
          {
            id: "tim",
            name,
            revision,
            updatedAt: `2024-01-0${revision}T00:00:00.000Z`,
          },
        ],
      })
    store.applyFullPull(serverPull(1, "Server"))

    const pushResponse = deferred<Response>()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      pushResponse.promise) as unknown as typeof fetch
    try {
      update((previous) => ({
        ...previous,
        persons: {
          ...previous.persons,
          tim: {
            id: "tim",
            name: "Local",
            revision: previous.persons.tim?.revision,
            updatedAt: previous.persons.tim?.updatedAt,
          },
        },
      }))
      await Promise.resolve()
      store.applyFullPull(serverPull(2, "Remote"))

      expect(store.getSnapshot().persons.tim?.name).toBe("Local")
      expect(store.getSnapshot().persons.tim?.revision).toBe(2)
      expect(store.snapshotDirty().persons.get("tim")).toMatchObject({
        action: "upsert",
        baseRevision: 1,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
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

  test("final parent unlink sends only the tree association tombstone", async () => {
    const store = await freshStore()
    const previous = relationshipState()
    delete previous.treeParentChildRelationships['["b","parent"]']
    const removed = store.removeParentRecords(previous, "a", "kid", "tim")
    const stamped = store.stampAndEnqueue(previous, removed)
    const dirty = store.snapshotDirty()

    expect(stamped.parentChildRelationships.parent).toBeUndefined()
    expect([...dirty.parentChildRelationships]).toEqual([])
    expect(
      dirty.treeParentChildRelationships.get('["a","parent"]'),
    ).toMatchObject({ action: "delete" })
    expect(
      store.buildPushWires(stamped, dirty, timestamp).parentChildRelationships,
    ).toEqual([])
  })

  test("coalesces a never-synchronized create followed by delete", async () => {
    const store = await freshStore()
    const previous = emptyState()
    const created = store.stampAndEnqueue(previous, {
      ...previous,
      persons: {
        person: { id: "person", name: "Person", updatedAt: timestamp },
      },
    })
    expect(store.snapshotDirty().persons.get("person")).toMatchObject({
      action: "upsert",
      baseRevision: undefined,
    })

    store.stampAndEnqueue(created, { ...created, persons: {} })

    expect([...store.snapshotDirty().persons]).toEqual([])
  })

  test("assembles snapshot pages before returning", async () => {
    const store = await freshStore()
    const base: Omit<TreeSnapshotResponse, "records"> = {
      tree: {
        id: "a",
        name: "A",
        ownerId: "owner",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      syncVersion: 2,
      cursor: "change-cursor",
    }
    const firstPage: TreeSnapshotResponse = {
      ...base,
      records: {
        persons: [{ id: "person", name: "Person", updatedAt: timestamp }],
        treeMembers: [],
        unions: [],
        unionEvents: [],
        treeUnions: [],
        parentChildRelationships: [],
        treeParentChildRelationships: [],
      },
      nextCursor: "next-page",
    }
    const secondPage: TreeSnapshotResponse = {
      ...base,
      records: {
        persons: [],
        treeMembers: [
          {
            treeId: "a",
            personId: "person",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        unions: [],
        unionEvents: [],
        treeUnions: [],
        parentChildRelationships: [],
        treeParentChildRelationships: [],
      },
    }
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (input) => {
      calls++
      if (calls === 1) return Response.json(firstPage)
      expect(String(input)).toContain("pageCursor=next-page")
      return Response.json(secondPage)
    }) as typeof fetch

    try {
      const snapshot = await store.fetchTreeSnapshot("a")
      expect(snapshot.records.persons).toHaveLength(1)
      expect(snapshot.records.treeMembers).toHaveLength(1)
      expect(calls).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
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

  test("builds normalized tombstones and includes every collection", async () => {
    const store = await freshStore()
    const dirty: DirtyState = store.snapshotDirty()
    dirty.trees.set("a", {
      action: "delete",
      revision: 1,
      baseRevision: 7,
    })
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
      revision: 7,
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

  test("takes bounded dirty batches in dependency order", async () => {
    const store = await freshStore()
    const dirty = store.snapshotDirty()
    dirty.persons.set("first", { action: "upsert", revision: 1 })
    dirty.persons.set("second", { action: "upsert", revision: 2 })
    dirty.trees.set("tree", { action: "upsert", revision: 3 })

    const batch = store.takeDirtyBatch(dirty, 2)
    expect([...batch.persons.keys()]).toEqual(["first", "second"])
    expect(batch.trees.size).toBe(0)
  })

  test("does not combine separate logical operations in one batch", async () => {
    const store = await freshStore()
    const dirty = store.snapshotDirty()
    dirty.persons.set("first", {
      action: "upsert",
      revision: 1,
      operationId: "operation-a",
    })
    dirty.trees.set("tree", {
      action: "upsert",
      revision: 2,
      operationId: "operation-b",
    })

    const batch = store.takeDirtyBatch(dirty, 10)
    expect([...batch.persons.keys()]).toEqual(["first"])
    expect(batch.trees.size).toBe(0)
  })

  test("groups blocked records into user-facing operations", async () => {
    const store = await freshStore()
    const currentState = relationshipState()
    const dirty = store.snapshotDirty()
    dirty.persons.set("tim", {
      action: "upsert",
      revision: 1,
      operationId: "edit-tim",
      blocked: true,
    })
    dirty.treeMembers.set(store.treeMemberKey("tree", "tim"), {
      action: "upsert",
      revision: 2,
      operationId: "edit-tim",
      blocked: true,
    })
    dirty.treeMembers.set(store.treeMemberKey("tree", "jane"), {
      action: "delete",
      revision: 3,
      operationId: "remove-jane",
      blocked: true,
    })

    expect(store.blockedChangesForTree(currentState, dirty, "tree")).toEqual([
      {
        id: "edit-tim",
        action: "upsert",
        label: "Update Tim",
        reason: "This change conflicts with a newer server version.",
        retryable: true,
        device: [],
        server: [],
      },
      {
        id: "remove-jane",
        action: "delete",
        label: "Remove family connection",
        reason: "This change conflicts with a newer server version.",
        retryable: true,
        device: [],
        server: [],
      },
    ])
  })

  test("keeps stored photos without returning blob URLs in push commands", async () => {
    const store = await freshStore()
    store.applyFullPull(
      fullPull({
        persons: [
          {
            id: "person",
            name: "Person",
            hasPhoto: true,
            updatedAt: timestamp,
          },
        ],
      }),
    )
    const snapshot = store.getSnapshot()
    const person = snapshot.persons.person
    if (!person) throw new Error("expected pulled person")
    const dirty = store.snapshotDirty()
    dirty.persons.set("person", { action: "upsert", revision: 1 })

    expect(
      store.buildPushWires(snapshot, dirty, timestamp).persons[0],
    ).not.toHaveProperty("photo")
    expect(
      store.buildPushWires(
        {
          ...snapshot,
          persons: {
            ...snapshot.persons,
            person: { ...person, photo: undefined },
          },
        },
        dirty,
        timestamp,
      ).persons[0],
    ).toHaveProperty("photo", null)
  })

  test("update push sends the corrected dirty base revision, not the stale record revision", async () => {
    const store = await freshStore()
    store.applyFullPull(
      fullPull({
        persons: [
          {
            id: "person",
            name: "Person",
            revision: 1,
            updatedAt: timestamp,
          },
        ],
      }),
    )
    const snapshot = store.getSnapshot()
    expect(snapshot.persons.person?.revision).toBe(1)
    const dirty = store.snapshotDirty()
    // Conflict-resolution retry: the live record stays at the stale revision
    // 1, but the dirty base is corrected to the server's current revision 2.
    dirty.persons.set("person", {
      action: "upsert",
      revision: 1,
      baseRevision: 2,
    })

    expect(
      store.buildPushWires(snapshot, dirty, timestamp).persons[0],
    ).toMatchObject({ id: "person", revision: 2 })
  })

  test("keeps a tree visible until server deletion succeeds", async () => {
    const store = await freshStore()
    store.applyFullPull(
      fullPull({
        persons: [
          {
            id: "tim",
            name: "Tim",
            updatedAt: timestamp,
            ownerId: "owner",
          },
        ],
        trees: [
          {
            id: "a",
            name: "A",
            createdAt: timestamp,
            revision: 1,
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
      }),
    )
    const response = deferred<Response>()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      expect(input).toBe("/api/mutations")
      expect(init?.method).toBe("POST")
      expect(init?.credentials).toBe("include")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        protocolVersion: 2,
        records: { trees: [{ id: "a", revision: 1 }] },
      })
      return response.promise
    }) as typeof fetch

    try {
      const deletion = store.deleteTreeById("a")
      expect(store.getSnapshot().index.some((tree) => tree.id === "a")).toBe(
        true,
      )
      expect(Object.values(store.getSnapshot().treeMembers)).toHaveLength(1)

      response.resolve(new Response(JSON.stringify({ ok: true })))
      await deletion

      expect(store.getSnapshot().index.some((tree) => tree.id === "a")).toBe(
        false,
      )
      expect(Object.values(store.getSnapshot().treeMembers)).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("keeps a tree visible when server deletion fails", async () => {
    const store = await freshStore()
    store.applyFullPull(
      fullPull({
        trees: [
          {
            id: "a",
            name: "A",
            createdAt: timestamp,
            revision: 1,
            updatedAt: timestamp,
            ownerId: "owner",
          },
        ],
      }),
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, _init) =>
      new Response(JSON.stringify({ error: "tree not found" }), {
        status: 404,
      })) as typeof fetch

    try {
      await expect(store.deleteTreeById("a")).rejects.toThrow(
        "delete failed: 404",
      )
      expect(store.getSnapshot().index.some((tree) => tree.id === "a")).toBe(
        true,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
