import { describe, expect, test } from "bun:test"
import {
  activeDependencyIds,
  associationKey,
  clientCanTombstone,
  isCanonicalUnion,
  isReasonableClientTimestamp,
  isValidIsoDate,
  isValidPartialDate,
  isValidSyncId,
  isValidSyncPushRequest,
  isValidTimestamp,
  MAX_SYNC_ID_LENGTH,
  MAX_SYNC_PHOTO_LENGTH,
  MAX_SYNC_RECORDS_PER_COLLECTION,
  MAX_SYNC_TEXT_LENGTH,
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

  test("accepts partial (year / year-month) person dates", () => {
    expect(isValidPartialDate("1950")).toBe(true)
    expect(isValidPartialDate("1950-05")).toBe(true)
    expect(isValidPartialDate("1950-05-01")).toBe(true)
    expect(isValidPartialDate("1950-13")).toBe(false)
    expect(isValidPartialDate("1950-00")).toBe(false)
    expect(isValidPartialDate("1950-5")).toBe(false)
    expect(isValidPartialDate("")).toBe(false)
    expect(isValidPartialDate("19-05")).toBe(false)
    expect(isValidPartialDate("not-a-date")).toBe(false)
  })

  test("accepts valid client metadata timestamps without using clock ordering", () => {
    expect(isReasonableClientTimestamp(TIMESTAMP, NOW)).toBe(true)
    expect(
      isReasonableClientTimestamp(
        new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        NOW,
      ),
    ).toBe(true)
    expect(isReasonableClientTimestamp("not-a-date", NOW)).toBe(false)
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

    const commandTree = emptyPayload()
    commandTree.trees = [
      {
        id: "tree",
        name: "Tree",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ]
    expect(isValidSyncPushRequest(commandTree, NOW)).toBe(true)

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

  test("accepts positive server revisions and rejects invalid revisions", () => {
    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          revision: 2,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          revision: 0,
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
  })

  test("rejects malformed IDs and duplicate identities", () => {
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

  test("bounds collection counts and user-controlled text", () => {
    const tooManyRecords = emptyPayload()
    tooManyRecords.persons = Array.from(
      { length: MAX_SYNC_RECORDS_PER_COLLECTION + 1 },
      (_, index) => ({
        id: `person-${index}`,
        name: "Person",
        updatedAt: TIMESTAMP,
      }),
    )
    expect(isValidSyncPushRequest(tooManyRecords, NOW)).toBe(false)

    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "a".repeat(MAX_SYNC_TEXT_LENGTH + 1),
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
          photo: "a".repeat(MAX_SYNC_PHOTO_LENGTH + 1),
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(false)
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

  test("accepts partial person dates but keeps union events full-date only", () => {
    expect(
      isValidSyncPushRequest(
        payloadWith("persons", {
          id: "person",
          name: "Person",
          dob: "1950",
          dod: "2019-05",
          updatedAt: TIMESTAMP,
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isValidSyncPushRequest(
        payloadWith("unionEvents", {
          id: "event",
          unionId: "union",
          type: "married",
          eventDate: "1950-05",
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
})
