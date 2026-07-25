import { describe, expect, test } from "bun:test"
import {
  activeDependencyIds,
  associationKey,
  clientCanTombstone,
  isCanonicalUnion,
  isReasonableClientTimestamp,
  isValidIsoDate,
  isValidSyncId,
  isValidSyncPushRequest,
  isValidTimestamp,
  MAX_CLIENT_FUTURE_MILLISECONDS,
  MAX_SYNC_ID_LENGTH,
  type ParentEdge,
  validateParentAssociation,
} from "./sync-validation"

const NOW = new Date("2026-07-25T01:02:03.000Z")
const TIMESTAMP = NOW.toISOString()

function emptyPayload(): Record<string, unknown[]> {
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

function payloadWith(
  collection: string,
  record: unknown,
): Record<string, unknown[]> {
  const payload = emptyPayload()
  payload[collection] = [record]
  return payload
}

const EDGES: ParentEdge[] = [
  { id: "grandparent-parent", parentPersonId: "a", childPersonId: "b" },
  { id: "parent-child", parentPersonId: "b", childPersonId: "c" },
]

describe("sync validation", () => {
  test("uses the client association key format", () => {
    expect(associationKey("tree", "person")).toBe('["tree","person"]')
  })

  test("requires strictly canonical union endpoints", () => {
    expect(isCanonicalUnion("a", "b")).toBe(true)
    expect(isCanonicalUnion("b", "a")).toBe(false)
    expect(isCanonicalUnion("a", "a")).toBe(false)
  })

  test("selects dependency IDs only from active association rows", () => {
    const active = { id: "active", deletedAt: null }
    const former = { id: "former", deletedAt: new Date(TIMESTAMP) }
    expect(activeDependencyIds([active, former], (row) => row.id)).toEqual([
      "active",
    ])
  })

  test("requires bounded printable ASCII sync IDs", () => {
    expect(isValidSyncId("person-1_ABC.2")).toBe(true)
    expect(isValidSyncId("")).toBe(false)
    expect(isValidSyncId("line\nbreak")).toBe(false)
    expect(isValidSyncId("tab\tvalue")).toBe(false)
    expect(isValidSyncId("delete\x7f")).toBe(false)
    expect(isValidSyncId("josé")).toBe(false)
    expect(isValidSyncId("a".repeat(MAX_SYNC_ID_LENGTH))).toBe(true)
    expect(isValidSyncId("a".repeat(MAX_SYNC_ID_LENGTH + 1))).toBe(false)
  })

  test("validates timestamps and exact ISO dates", () => {
    expect(isValidTimestamp("2026-07-25T01:02:03.000Z")).toBe(true)
    expect(isValidTimestamp("not-a-date")).toBe(false)
    expect(isValidTimestamp(0)).toBe(false)
    expect(isValidIsoDate("2024-02-29")).toBe(true)
    expect(isValidIsoDate("2023-02-29")).toBe(false)
    expect(isValidIsoDate("0001-01-01")).toBe(true)
    expect(isValidIsoDate("2024-2-9")).toBe(false)
  })

  test("bounds client timestamps to reasonable clock skew", () => {
    expect(isReasonableClientTimestamp(TIMESTAMP, NOW)).toBe(true)
    expect(
      isReasonableClientTimestamp(
        new Date(NOW.getTime() + MAX_CLIENT_FUTURE_MILLISECONDS).toISOString(),
        NOW,
      ),
    ).toBe(true)
    expect(
      isReasonableClientTimestamp(
        new Date(
          NOW.getTime() + MAX_CLIENT_FUTURE_MILLISECONDS + 1,
        ).toISOString(),
        NOW,
      ),
    ).toBe(false)
  })

  test("validates every collection and exact discriminated wire shape", () => {
    expect(isValidSyncPushRequest(emptyPayload(), NOW)).toBe(true)

    const complete = emptyPayload()
    complete.persons = [
      { id: "a", name: "A", gender: "other", updatedAt: TIMESTAMP },
    ]
    complete.trees = [
      {
        id: "tree",
        name: "Tree",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        ownerId: "owner",
        role: "owner",
      },
    ]
    complete.treeMembers = [
      {
        treeId: "tree",
        personId: "a",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    complete.unions = [
      {
        id: "union",
        firstPersonId: "a",
        secondPersonId: "b",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    complete.unionEvents = [
      {
        id: "event",
        unionId: "union",
        type: "married",
        eventDate: "2024-02-29",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    complete.treeUnions = [
      {
        treeId: "tree",
        unionId: "union",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    complete.parentChildRelationships = [
      {
        id: "parent",
        parentPersonId: "a",
        childPersonId: "child",
        type: "biological",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    complete.treeParentChildRelationships = [
      {
        treeId: "tree",
        parentChildRelationshipId: "parent",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    expect(isValidSyncPushRequest(complete, NOW)).toBe(true)

    const newTree = emptyPayload()
    newTree.trees = [
      {
        id: "tree",
        name: "Tree",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        ownerId: "",
      },
    ]
    expect(isValidSyncPushRequest(newTree, NOW)).toBe(true)

    const malformedTombstone = emptyPayload()
    malformedTombstone.persons = [
      {
        id: "person",
        name: "extra",
        updatedAt: TIMESTAMP,
        deletedAt: TIMESTAMP,
      },
    ]
    expect(isValidSyncPushRequest(malformedTombstone, NOW)).toBe(false)

    const unknownTopLevel = { ...emptyPayload(), unexpected: [] }
    expect(isValidSyncPushRequest(unknownTopLevel, NOW)).toBe(false)

    const missingCollection = emptyPayload()
    delete missingCollection.treeUnions
    expect(isValidSyncPushRequest(missingCollection, NOW)).toBe(false)
  })

  test("rejects malformed IDs, duplicate identities, and future wire timestamps", () => {
    const malformedId = emptyPayload()
    malformedId.treeMembers = [
      {
        treeId: "",
        personId: "person",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    expect(isValidSyncPushRequest(malformedId, NOW)).toBe(false)

    const nullByteId = emptyPayload()
    nullByteId.persons = [
      { id: "person\0", name: "Person", updatedAt: TIMESTAMP },
    ]
    expect(isValidSyncPushRequest(nullByteId, NOW)).toBe(false)

    const duplicate = emptyPayload()
    duplicate.persons = [
      { id: "person", name: "First", updatedAt: TIMESTAMP },
      { id: "person", name: "Second", updatedAt: TIMESTAMP },
    ]
    expect(isValidSyncPushRequest(duplicate, NOW)).toBe(false)

    const future = emptyPayload()
    future.persons = [
      {
        id: "person",
        name: "Future",
        updatedAt: new Date(
          NOW.getTime() + MAX_CLIENT_FUTURE_MILLISECONDS + 1,
        ).toISOString(),
      },
    ]
    expect(isValidSyncPushRequest(future, NOW)).toBe(false)

    const nonCanonicalUnion = emptyPayload()
    nonCanonicalUnion.unions = [
      {
        id: "union",
        firstPersonId: "b",
        secondPersonId: "a",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    expect(isValidSyncPushRequest(nonCanonicalUnion, NOW)).toBe(false)
  })

  test("applies ID validation to every wire shape", () => {
    const invalidId = "bad\nidentifier"
    const recordsByCollection: Array<[string, Record<string, unknown>]> = [
      ["persons", { id: invalidId, name: "Person", updatedAt: TIMESTAMP }],
      [
        "trees",
        {
          id: invalidId,
          name: "Tree",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
          ownerId: "owner",
        },
      ],
      [
        "treeMembers",
        {
          treeId: "tree",
          personId: invalidId,
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      [
        "unions",
        {
          id: "union",
          firstPersonId: invalidId,
          secondPersonId: "person",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      [
        "unionEvents",
        {
          id: "event",
          unionId: invalidId,
          type: "married",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      [
        "treeUnions",
        {
          treeId: "tree",
          unionId: invalidId,
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      [
        "parentChildRelationships",
        {
          id: "parent",
          parentPersonId: invalidId,
          childPersonId: "child",
          type: "biological",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
      [
        "treeParentChildRelationships",
        {
          treeId: "tree",
          parentChildRelationshipId: invalidId,
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      ],
    ]

    for (const [collection, record] of recordsByCollection) {
      expect(isValidSyncPushRequest(payloadWith(collection, record), NOW)).toBe(
        false,
      )
    }

    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          ownerId: invalidId,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("trees", {
          id: "tree",
          name: "Tree",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
          ownerId: invalidId,
        }),
        NOW,
      ),
    ).toBe(false)
  })

  test("rejects invalid imported dates and enum types", () => {
    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          dob: "2023-02-29",
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          gender: "unknown",
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("unionEvents", {
          id: "event",
          unionId: "union",
          type: "married",
          eventDate: "2024-02-30",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("unionEvents", {
          id: "event",
          unionId: "union",
          type: "wedding",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("trees", {
          id: "tree",
          name: "Tree",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
          ownerId: "owner",
          role: "administrator",
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isValidSyncPushRequest(
        payloadWith("parentChildRelationships", {
          id: "parent",
          parentPersonId: "parent-person",
          childPersonId: "child-person",
          type: "unknown",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
  })

  test("accepts global tombstone shapes but policy rejects their deletion", () => {
    const payload = emptyPayload()
    payload.unions = [
      { id: "union", updatedAt: TIMESTAMP, deletedAt: TIMESTAMP },
    ]
    payload.unionEvents = [
      { id: "event", updatedAt: TIMESTAMP, deletedAt: TIMESTAMP },
    ]
    payload.parentChildRelationships = [
      { id: "parent", updatedAt: TIMESTAMP, deletedAt: TIMESTAMP },
    ]
    expect(isValidSyncPushRequest(payload, NOW)).toBe(true)
    expect(clientCanTombstone("unions")).toBe(false)
    expect(clientCanTombstone("unionEvents")).toBe(false)
    expect(clientCanTombstone("parentChildRelationships")).toBe(false)
    expect(clientCanTombstone("treeUnions")).toBe(true)
  })

  test("accepts a second distinct parent and rejects a third", () => {
    const current = [
      { id: "first", parentPersonId: "a", childPersonId: "child" },
    ]
    expect(
      validateParentAssociation(current, {
        id: "second",
        parentPersonId: "b",
        childPersonId: "child",
      }),
    ).toBe("valid")
    expect(
      validateParentAssociation(
        [
          ...current,
          { id: "second", parentPersonId: "b", childPersonId: "child" },
        ],
        {
          id: "third",
          parentPersonId: "c",
          childPersonId: "child",
        },
      ),
    ).toBe("too-many-parents")
  })

  test("enforces the two-parent limit across the global fact set", () => {
    const globalFacts = [
      { id: "tree-a-parent", parentPersonId: "a", childPersonId: "child" },
      { id: "tree-b-parent", parentPersonId: "b", childPersonId: "child" },
    ]
    expect(
      validateParentAssociation(globalFacts, {
        id: "tree-c-parent",
        parentPersonId: "c",
        childPersonId: "child",
      }),
    ).toBe("too-many-parents")
  })

  test("does not count a replacement or duplicate parent twice", () => {
    expect(
      validateParentAssociation(
        [{ id: "same", parentPersonId: "a", childPersonId: "child" }],
        { id: "same", parentPersonId: "a", childPersonId: "child" },
      ),
    ).toBe("valid")
    expect(
      validateParentAssociation(
        [
          { id: "first", parentPersonId: "a", childPersonId: "child" },
          { id: "duplicate", parentPersonId: "a", childPersonId: "child" },
          { id: "second", parentPersonId: "b", childPersonId: "child" },
        ],
        { id: "duplicate", parentPersonId: "a", childPersonId: "child" },
      ),
    ).toBe("valid")
  })

  test("rejects self-parenting and direct or transitive cycles", () => {
    expect(
      validateParentAssociation([], {
        id: "self",
        parentPersonId: "a",
        childPersonId: "a",
      }),
    ).toBe("self-parent")
    expect(
      validateParentAssociation(EDGES, {
        id: "cycle",
        parentPersonId: "c",
        childPersonId: "a",
      }),
    ).toBe("ancestry-cycle")
  })
})
