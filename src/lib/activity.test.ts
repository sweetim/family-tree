import { describe, expect, test } from "bun:test"
import type { SyncRecordSet, TreeActivityChange } from "../sync/types"
import { formatRelativeTime, summarizeChange } from "./activity"

const NOW = new Date("2026-08-07T12:00:00.000Z")
const ISO = NOW.toISOString()

function change(partials: Partial<SyncRecordSet>): TreeActivityChange {
  return {
    version: 1,
    mutationId: "mutation-1",
    createdAt: ISO,
    author: null,
    records: {
      persons: [],
      trees: [],
      treeMembers: [],
      unions: [],
      unionEvents: [],
      treeUnions: [],
      parentChildRelationships: [],
      treeParentChildRelationships: [],
      ...partials,
    },
  }
}

// resolveName only knows p1/p2; everyone else is "a person".
const resolveName = (id: string): string | undefined =>
  id === "p1" ? "Alice Adams" : id === "p2" ? "Bob Brown" : undefined

describe("summarizeChange", () => {
  test("the change's author passes through as authorName", () => {
    const entry = summarizeChange(
      { ...change({}), author: { name: "You" } },
      resolveName,
    )
    expect(entry.authorName).toBe("You")
  })

  test("a created person is reported as Added with their name", () => {
    const entry = summarizeChange(
      change({
        persons: [
          {
            id: "p3",
            name: "Cara",
            familyName: "Cole",
            revision: 1,
            updatedAt: ISO,
          },
        ],
      }),
      resolveName,
    )
    expect(entry).toEqual({
      version: 1,
      createdAt: ISO,
      icon: "add",
      text: "Added Cara Cole",
      authorName: null,
    })
  })

  test("two created people are joined with 'and'", () => {
    const entry = summarizeChange(
      change({
        persons: [
          {
            id: "p3",
            name: "Cara",
            familyName: "Cole",
            revision: 1,
            updatedAt: ISO,
          },
          { id: "p4", name: "Dana", revision: 1, updatedAt: ISO },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Added Cara Cole and Dana")
    expect(entry.icon).toBe("add")
  })

  test("a higher-revision person is reported as Edited", () => {
    const entry = summarizeChange(
      change({
        persons: [
          {
            id: "p3",
            name: "Cara",
            familyName: "Cole",
            revision: 2,
            updatedAt: ISO,
          },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Edited Cara Cole")
    expect(entry.icon).toBe("edit")
  })

  test("a removed person is named when still known, else collapsed to a count", () => {
    expect(
      summarizeChange(
        change({ persons: [{ id: "p1", updatedAt: ISO, deletedAt: ISO }] }),
        resolveName,
      ).text,
    ).toBe("Removed Alice Adams")

    expect(
      summarizeChange(
        change({ persons: [{ id: "pX", updatedAt: ISO, deletedAt: ISO }] }),
        resolveName,
      ).text,
    ).toBe("Removed a person")

    expect(
      summarizeChange(
        change({
          persons: [
            { id: "pX", updatedAt: ISO, deletedAt: ISO },
            { id: "pY", updatedAt: ISO, deletedAt: ISO },
          ],
        }),
        resolveName,
      ).text,
    ).toBe("Removed 2 people")
  })

  test("removals take priority over other signals", () => {
    const entry = summarizeChange(
      change({
        persons: [{ id: "p1", updatedAt: ISO, deletedAt: ISO }],
        unions: [{ id: "u1", deletedAt: ISO, updatedAt: ISO, revision: 3 }],
      }),
      resolveName,
    )
    expect(entry.icon).toBe("remove")
    expect(entry.text).toBe("Removed Alice Adams")
  })

  test("a marriage event reads 'Recorded a marriage'", () => {
    const entry = summarizeChange(
      change({
        unionEvents: [
          {
            id: "e1",
            unionId: "u1",
            type: "married",
            createdAt: ISO,
            revision: 1,
            updatedAt: ISO,
          },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Recorded a marriage")
    expect(entry.icon).toBe("relationship")
  })

  test("a fresh union is an added relationship", () => {
    const entry = summarizeChange(
      change({
        unions: [
          {
            id: "u1",
            firstPersonId: "p1",
            secondPersonId: "p2",
            createdAt: ISO,
            revision: 1,
            updatedAt: ISO,
          },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Added a relationship")
    expect(entry.icon).toBe("relationship")
  })

  test("a tombstoned union is a removed relationship", () => {
    const entry = summarizeChange(
      change({ unions: [{ id: "u1", deletedAt: ISO, updatedAt: ISO }] }),
      resolveName,
    )
    expect(entry.text).toBe("Removed a relationship")
    expect(entry.icon).toBe("remove")
  })

  test("a fresh parent-child link is reported as linked", () => {
    const entry = summarizeChange(
      change({
        parentChildRelationships: [
          {
            id: "r1",
            parentPersonId: "p1",
            childPersonId: "p2",
            type: "biological",
            createdAt: ISO,
            revision: 1,
            updatedAt: ISO,
          },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Linked a parent and child")
    expect(entry.icon).toBe("add")
  })

  test("a tombstoned parent-child link is removed", () => {
    const entry = summarizeChange(
      change({
        parentChildRelationships: [
          { id: "r1", deletedAt: ISO, updatedAt: ISO },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Removed a parent-child link")
    expect(entry.icon).toBe("remove")
  })

  test("a touched tree record reads 'Updated tree settings'", () => {
    const entry = summarizeChange(
      change({
        trees: [
          {
            id: "t1",
            name: "My Family",
            createdAt: ISO,
            revision: 2,
            updatedAt: ISO,
            ownerId: "u1",
          },
        ],
      }),
      resolveName,
    )
    expect(entry.text).toBe("Updated tree settings")
    expect(entry.icon).toBe("tree")
  })

  test("an empty change falls back to a neutral line", () => {
    const entry = summarizeChange(change({}), resolveName)
    expect(entry.text).toBe("Tree updated")
    expect(entry.icon).toBe("tree")
  })
})

describe("formatRelativeTime", () => {
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  test("just now under 45 seconds", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 10_000).toISOString(), NOW),
    ).toBe("just now")
  })

  test("minutes", () => {
    expect(
      formatRelativeTime(
        new Date(NOW.getTime() - 5 * minute).toISOString(),
        NOW,
      ),
    ).toBe("5m ago")
  })

  test("hours", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 3 * hour).toISOString(), NOW),
    ).toBe("3h ago")
  })

  test("yesterday at one day", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - day).toISOString(), NOW),
    ).toBe("yesterday")
  })

  test("days", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 3 * day).toISOString(), NOW),
    ).toBe("3d ago")
  })
})
