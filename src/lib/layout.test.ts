import { describe, expect, test } from "bun:test"
import type { FamilyData, Person } from "../types"
import { buildFlow, computeTreeLayout } from "./layout"

const PERSON = (id: string, gender: Person["gender"]): Person => ({
  id,
  name: id,
  familyName: "",
  gender,
  parents: [],
  spouseIds: [],
  marriageDates: {},
})

/** Build positions -> a 0-based rank per person, derived from the laid-out
 *  y so the test does not hardcode layout constants. */
function ranksOf(people: FamilyData): Map<string, number> {
  const { nodes } = buildFlow(people, computeTreeLayout(people))
  const ys = [
    ...new Set(
      nodes
        .filter((node) => node.type === "person")
        .map((node) => Math.round(node.position.y)),
    ),
  ].sort((a, b) => a - b)
  const yToRank = new Map(ys.map((y, index) => [y, index]))
  const ranks = new Map<string, number>()
  for (const node of nodes) {
    if (node.type === "person")
      ranks.set(node.id, yToRank.get(Math.round(node.position.y)) ?? -1)
  }
  return ranks
}

/** Every visible parent must sit exactly one rank above its child. Returns
 *  the list of violations. */
function gapViolations(people: FamilyData): string[] {
  const ranks = ranksOf(people)
  const violations: string[] = []
  for (const [childId, child] of Object.entries(people)) {
    const childRank = ranks.get(childId)
    if (childRank === undefined) continue
    for (const link of child.parents) {
      if (!people[link.id]) continue
      const parentRank = ranks.get(link.id)
      if (parentRank === undefined) continue
      if (childRank - parentRank !== 1)
        violations.push(
          `${link.id}(rank ${parentRank}) -> ${childId}(rank ${childRank})`,
        )
    }
  }
  return violations
}

describe("layout rank spacing", () => {
  test("in-law parents stay one row above when the spouse's side is deeper", () => {
    // Husband A has shallow ancestry (parents only). Wife B marries A and
    // brings a deeper line (grandparents). Before the fix, A's parents were
    // stranded two rows above A; they must sit exactly one row above.
    const people: FamilyData = {
      Af: { ...PERSON("Af", "male"), spouseIds: ["Am"] },
      Am: { ...PERSON("Am", "female"), spouseIds: ["Af"] },
      A: {
        ...PERSON("A", "male"),
        spouseIds: ["B"],
        parents: [{ id: "Af" }, { id: "Am" }],
      },
      Bgf: { ...PERSON("Bgf", "male"), spouseIds: ["Bgm"] },
      Bgm: { ...PERSON("Bgm", "female"), spouseIds: ["Bgf"] },
      Bf: {
        ...PERSON("Bf", "male"),
        spouseIds: ["Bm"],
        parents: [{ id: "Bgf" }, { id: "Bgm" }],
      },
      Bm: {
        ...PERSON("Bm", "female"),
        spouseIds: ["Bf"],
        parents: [{ id: "Bgf" }, { id: "Bgm" }],
      },
      B: {
        ...PERSON("B", "female"),
        spouseIds: ["A"],
        parents: [{ id: "Bf" }, { id: "Bm" }],
      },
    }

    const ranks = ranksOf(people)
    expect(gapViolations(people)).toEqual([])

    // A and B are spouses -> same row; A's parents and B's parents align.
    expect(ranks.get("A")).toBe(ranks.get("B"))
    expect(ranks.get("Af")).toBe(ranks.get("Bf"))
    expect(ranks.get("A")).toBe((ranks.get("Af") ?? 0) + 1)
  })

  test("parent is exactly one rank above its child across many depths", () => {
    // Two ancestries of independent depth, joined by a marriage at the bottom.
    // Sweep depth on each side and assert the 1-row invariant never breaks.
    const buildLine = (prefix: string, depth: number): FamilyData => {
      const family: FamilyData = {}
      for (let gen = 0; gen < depth; gen++) {
        const father = `${prefix}_g${gen}f`
        const mother = `${prefix}_g${gen}m`
        family[father] = { ...PERSON(father, "male"), spouseIds: [mother] }
        family[mother] = { ...PERSON(mother, "female"), spouseIds: [father] }
        if (gen > 0) {
          const prevFather = family[`${prefix}_g${gen - 1}f`]
          const prevMother = family[`${prefix}_g${gen - 1}m`]
          if (prevFather) prevFather.parents = [{ id: father }, { id: mother }]
          if (prevMother) prevMother.parents = [{ id: father }, { id: mother }]
        }
      }
      const focal = PERSON(prefix, prefix === "A" ? "male" : "female")
      if (depth > 0) {
        focal.parents = [
          { id: `${prefix}_g${depth - 1}f` },
          { id: `${prefix}_g${depth - 1}m` },
        ]
      }
      family[prefix] = focal
      return family
    }

    for (let aDepth = 0; aDepth <= 3; aDepth++) {
      for (let bDepth = 0; bDepth <= 3; bDepth++) {
        const people: FamilyData = {
          ...buildLine("A", aDepth),
          ...buildLine("B", bDepth),
        }
        const a = people.A
        const b = people.B
        if (a) a.spouseIds = ["B"]
        if (b) b.spouseIds = ["A"]
        expect(gapViolations(people)).toEqual([])
      }
    }
  })

  test("a child whose sibling married deeper still shares its sibling's row", () => {
    // Parents P have two children: S (no spouse) and T (married to a deeper
    // line). S and T must land on the same row, with P one row above both.
    const people: FamilyData = {
      Pf: { ...PERSON("Pf", "male"), spouseIds: ["Pm"] },
      Pm: { ...PERSON("Pm", "female"), spouseIds: ["Pf"] },
      S: {
        ...PERSON("S", "other"),
        parents: [{ id: "Pf" }, { id: "Pm" }],
      },
      T: {
        ...PERSON("T", "other"),
        spouseIds: ["U"],
        parents: [{ id: "Pf" }, { id: "Pm" }],
      },
      // U's side is one generation deeper than S/T (U has grandparents).
      Wf: { ...PERSON("Wf", "male"), spouseIds: ["Wm"] },
      Wm: { ...PERSON("Wm", "female"), spouseIds: ["Wf"] },
      Xf: {
        ...PERSON("Xf", "male"),
        spouseIds: ["Xm"],
        parents: [{ id: "Wf" }, { id: "Wm" }],
      },
      Xm: {
        ...PERSON("Xm", "female"),
        spouseIds: ["Xf"],
        parents: [{ id: "Wf" }, { id: "Wm" }],
      },
      U: {
        ...PERSON("U", "other"),
        spouseIds: ["T"],
        parents: [{ id: "Xf" }, { id: "Xm" }],
      },
    }
    // The deeper U pulls the {S, T} generation down; P follows.
    const ranks = ranksOf(people)
    expect(ranks.get("S")).toBe(ranks.get("T"))
    expect(ranks.get("Pf")).toBe((ranks.get("S") ?? 0) - 1)
  })
})

describe("male-line connections", () => {
  test("animates only father-to-son edges while bloodline highlighting is on", () => {
    const people: FamilyData = {
      founder: { ...PERSON("founder", "male"), spouseIds: ["founder-wife"] },
      "founder-wife": {
        ...PERSON("founder-wife", "female"),
        spouseIds: ["founder"],
      },
      son: {
        ...PERSON("son", "male"),
        spouseIds: ["son-wife"],
        parents: [{ id: "founder" }, { id: "founder-wife" }],
      },
      "son-wife": { ...PERSON("son-wife", "female"), spouseIds: ["son"] },
      grandson: {
        ...PERSON("grandson", "male"),
        parents: [{ id: "son" }, { id: "son-wife" }],
      },
      daughter: {
        ...PERSON("daughter", "female"),
        spouseIds: ["daughter-husband"],
        parents: [{ id: "founder" }, { id: "founder-wife" }],
      },
      "daughter-husband": {
        ...PERSON("daughter-husband", "male"),
        spouseIds: ["daughter"],
      },
      "daughter-son": {
        ...PERSON("daughter-son", "male"),
        parents: [{ id: "daughter" }, { id: "daughter-husband" }],
      },
    }
    const { edges } = buildFlow(
      people,
      computeTreeLayout(people),
      undefined,
      undefined,
      true,
    )
    const edgeForChild = (childId: string) =>
      edges.find((edge) => edge.data?.childId === childId)

    for (const childId of ["son", "grandson"]) {
      expect(edgeForChild(childId)).toMatchObject({
        animated: true,
        zIndex: 500,
        style: { stroke: "#ef4444", strokeWidth: 4 },
        data: { maleLineConnection: true },
      })
    }
    for (const childId of ["daughter", "daughter-son"]) {
      expect(edgeForChild(childId)).toMatchObject({
        animated: false,
        data: { maleLineConnection: false },
      })
    }
  })
})
