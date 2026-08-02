import { describe, expect, test } from "bun:test"
import {
  ancestorsOf,
  childrenOf,
  type FamilyData,
  maleLineIds,
  type NormalizedRelationships,
  type PersonIdentity,
  projectTree,
  projectTreeStable,
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
  tim: { id: "tim", name: "Tim", familyName: "" },
  yumi: { id: "yumi", name: "Yumi", familyName: "" },
  kid: { id: "kid", name: "Kid", familyName: "" },
  parent: { id: "parent", name: "Foreign Parent", familyName: "" },
  partner: { id: "partner", name: "Foreign Partner", familyName: "" },
  child: { id: "child", name: "Foreign Child", familyName: "" },
  relative: { id: "relative", name: "Foreign Relative", familyName: "" },
}

describe("normalized projection", () => {
  test("projects membership, a canonical union event, and parent type", () => {
    const family = projectTree(identities, relationships(), "a")

    expect(family.tim?.spouseIds).toEqual(["yumi"])
    expect(family.yumi?.spouseIds).toEqual(["tim"])
    expect(family.tim?.marriageDates).toEqual({ yumi: "2020-05-01" })
    expect(family.tim?.unionStatus?.yumi).toEqual({
      type: "married",
      marriageDate: "2020-05-01",
    })
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
    // Divorced couples drop out of spouseIds but stay editable via unionStatus.
    expect(projectTree(identities, graph, "a").tim?.unionStatus?.yumi).toEqual({
      type: "divorced",
      marriageDate: "2020-05-01",
      date: "2023-01-01",
    })

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
  })

  test("follows male founders through uninterrupted father-to-son links", () => {
    const person = (
      id: string,
      gender: "male" | "female" | "other" | undefined,
      parents: string[] = [],
      spouseIds: string[] = [],
    ) => ({
      id,
      name: id,
      familyName: "",
      gender,
      parents: parents.map((parentId) => ({ id: parentId })),
      spouseIds,
      marriageDates: {},
    })
    const family: FamilyData = {
      founder: person("founder", "male", [], ["founder-wife"]),
      "founder-wife": person("founder-wife", "female", [], ["founder"]),
      son: person("son", "male", ["founder", "founder-wife"], ["son-wife"]),
      "son-wife": person("son-wife", "female", [], ["son"]),
      grandson: person("grandson", "male", ["son", "son-wife"]),
      daughter: person(
        "daughter",
        "female",
        ["founder", "founder-wife"],
        ["daughter-husband"],
      ),
      "daughter-husband": person("daughter-husband", "male", [], ["daughter"]),
      "daughter-son": person("daughter-son", "male", [
        "daughter",
        "daughter-husband",
      ]),
      "unknown-child": person("unknown-child", undefined, ["founder"]),
      "other-child": person("other-child", "other", ["founder"]),
    }

    expect(maleLineIds(family)).toEqual(new Set(["founder", "son", "grandson"]))
  })
})

describe("projectTreeStable", () => {
  test("returns the previous reference when nothing changed", () => {
    const rel = relationships()
    const first = projectTreeStable(
      undefined,
      undefined,
      undefined,
      identities,
      rel,
      "a",
    )
    const second = projectTreeStable(
      first,
      identities,
      rel,
      identities,
      rel,
      "a",
    )
    expect(second).toBe(first)
  })

  test("reuses unchanged Person objects when one identity changes", () => {
    const rel = relationships()
    const first = projectTreeStable(
      undefined,
      undefined,
      undefined,
      identities,
      rel,
      "a",
    )
    const nextIdentities: Record<string, PersonIdentity> = {
      ...identities,
      tim: { id: "tim", name: "Timothy", familyName: "" },
    }
    const second = projectTreeStable(
      first,
      identities,
      rel,
      nextIdentities,
      rel,
      "a",
    )
    expect(second).not.toBe(first)
    expect(second.tim).not.toBe(first.tim)
    expect(second.tim?.name).toBe("Timothy")
    expect(second.yumi).toBe(first.yumi)
    expect(second.kid).toBe(first.kid)
  })

  test("recomputes everyone when a relationship collection changes", () => {
    const rel = relationships()
    const first = projectTreeStable(
      undefined,
      undefined,
      undefined,
      identities,
      rel,
      "a",
    )
    const nextRel: NormalizedRelationships = {
      ...rel,
      unions: { ...rel.unions },
    }
    const second = projectTreeStable(
      first,
      identities,
      rel,
      identities,
      nextRel,
      "a",
    )
    expect(second.tim).not.toBe(first.tim)
  })

  test("first call with no previous projects normally", () => {
    const family = projectTreeStable(
      undefined,
      undefined,
      undefined,
      identities,
      relationships(),
      "a",
    )
    expect(family.tim?.spouseIds).toEqual(["yumi"])
  })
})
