import { describe, expect, test } from "bun:test"
import {
  ancestorsOf,
  childrenOf,
  focusFamily,
  type NormalizedRelationships,
  type PersonIdentity,
  projectTree,
  projectTrees,
  unionIsCurrent,
} from "./types"

const timestamp = "2024-01-01T00:00:00.000Z"

function relationships(): NormalizedRelationships {
  return {
    treeMembers: {
      '["a","tim"]': {
        treeId: "a",
        personId: "tim",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      '["a","yumi"]': {
        treeId: "a",
        personId: "yumi",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      '["a","kid"]': {
        treeId: "a",
        personId: "kid",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
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
      married: {
        id: "married",
        unionId: "union",
        type: "married",
        eventDate: "2020-05-01",
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
    },
    parentChildRelationships: {
      parent: {
        id: "parent",
        parentPersonId: "tim",
        childPersonId: "kid",
        type: "adoptive",
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
    },
  }
}

const identities: Record<string, PersonIdentity> = {
  tim: { id: "tim", name: "Tim" },
  yumi: { id: "yumi", name: "Yumi" },
  kid: { id: "kid", name: "Kid" },
  parent: { id: "parent", name: "Foreign Parent" },
  partner: { id: "partner", name: "Foreign Partner" },
  child: { id: "child", name: "Foreign Child" },
  relative: { id: "relative", name: "Foreign Relative" },
}

describe("normalized projection", () => {
  test("projects membership, a canonical union event, and parent type", () => {
    const family = projectTree(identities, relationships(), "a")

    expect(family.tim?.spouseIds).toEqual(["yumi"])
    expect(family.yumi?.spouseIds).toEqual(["tim"])
    expect(family.tim?.marriageDates).toEqual({ yumi: "2020-05-01" })
    expect(family.kid?.parents).toEqual([
      { id: "tim", adopted: true, type: "adoptive" },
    ])
  })

  test("requires tree associations but shares one global event", () => {
    const graph = relationships()
    graph.treeMembers['["b","tim"]'] = {
      treeId: "b",
      personId: "tim",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.treeMembers['["b","yumi"]'] = {
      treeId: "b",
      personId: "yumi",
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    expect(projectTree(identities, graph, "b").tim?.spouseIds).toEqual([])
    graph.treeUnions['["b","union"]'] = {
      treeId: "b",
      unionId: "union",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const married = graph.unionEvents.married
    if (!married) throw new Error("Missing marriage event fixture")
    graph.unionEvents.married = {
      ...married,
      eventDate: "2022-02-02",
    }

    expect(projectTree(identities, graph, "a").tim?.marriageDates.yumi).toBe(
      "2022-02-02",
    )
    expect(projectTree(identities, graph, "b").tim?.marriageDates.yumi).toBe(
      "2022-02-02",
    )
  })

  test("hides a terminated union while allowing a later synthetic union", () => {
    const graph = relationships()
    graph.unionEvents.divorced = {
      id: "divorced",
      unionId: "union",
      type: "divorced",
      eventDate: "2023-01-01",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-01T00:00:00.000Z",
    }
    expect(projectTree(identities, graph, "a").tim?.spouseIds).toEqual([])

    graph.unions.remarriage = {
      id: "remarriage",
      firstPersonId: "tim",
      secondPersonId: "yumi",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    }
    graph.unionEvents.remarried = {
      id: "remarried",
      unionId: "remarriage",
      type: "married",
      eventDate: "2024-02-01",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    }
    graph.treeUnions['["a","remarriage"]'] = {
      treeId: "a",
      unionId: "remarriage",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    }
    expect(projectTree(identities, graph, "a").tim?.spouseIds).toEqual(["yumi"])
  })

  test("show-all-families includes all members and relationships from other trees", () => {
    const graph = relationships()
    for (const personId of ["kid", "parent", "partner", "child", "relative"]) {
      graph.treeMembers[JSON.stringify(["b", personId])] = {
        treeId: "b",
        personId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    }
    graph.parentChildRelationships.foreign = {
      id: "foreign",
      parentPersonId: "parent",
      childPersonId: "kid",
      type: "biological",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.parentChildRelationships["foreign-child"] = {
      id: "foreign-child",
      parentPersonId: "parent",
      childPersonId: "child",
      type: "biological",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.treeParentChildRelationships['["b","foreign"]'] = {
      treeId: "b",
      parentChildRelationshipId: "foreign",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.treeParentChildRelationships['["b","foreign-child"]'] = {
      treeId: "b",
      parentChildRelationshipId: "foreign-child",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.unions["foreign-union"] = {
      id: "foreign-union",
      firstPersonId: "parent",
      secondPersonId: "partner",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    graph.treeUnions['["b","foreign-union"]'] = {
      treeId: "b",
      unionId: "foreign-union",
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const family = projectTrees(identities, graph, ["a", "b"])

    expect(family.kid?.parents.map((link) => link.id)).toEqual([
      "tim",
      "parent",
    ])
    expect(family.parent?.spouseIds).toEqual(["partner"])
    expect(family.child?.parents.map((link) => link.id)).toEqual(["parent"])
    expect(family.relative?.name).toBe("Foreign Relative")
  })

  test("uses deterministic ids when timestamps and event dates tie", () => {
    const graph = relationships()
    graph.unionEvents.annulled = {
      id: "z-event",
      unionId: "union",
      type: "annulled",
      eventDate: "2020-05-01",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    expect(unionIsCurrent("union", graph.unionEvents)).toBe(false)
    expect(Object.keys(projectTree(identities, graph, "a"))).toEqual([
      "kid",
      "tim",
      "yumi",
    ])
  })
})

describe("relationship traversal", () => {
  test("continues to consume the projected FamilyData contract", () => {
    const family = projectTree(identities, relationships(), "a")
    expect(childrenOf(family, "tim").map((person) => person.id)).toEqual([
      "kid",
    ])
    expect(ancestorsOf(family, "kid")).toEqual(new Set(["tim"]))
    expect(Object.keys(focusFamily(family, "kid")).sort()).toEqual([
      "kid",
      "tim",
      "yumi",
    ])
  })
})
