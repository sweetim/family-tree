import { describe, expect, test } from "bun:test"
import { seedData } from "../store/seed"
import type { FamilyData, Person } from "../types"
import { familyToGedcom } from "./gedcom"

const EXPORT_DATE = new Date(Date.UTC(2026, 7, 2))

function exportTree(people: FamilyData): string {
  return familyToGedcom(people, { date: EXPORT_DATE })
}

function person(
  partial: Partial<Person> & Pick<Person, "id" | "name">,
): Person {
  return {
    familyName: "",
    parents: [],
    spouseIds: [],
    marriageDates: {},
    ...partial,
  }
}

function linesOf(people: FamilyData): string[] {
  return exportTree(people).trimEnd().split("\n")
}

function block(lines: string[], start: string): string[] {
  const startIndex = lines.indexOf(start)
  if (startIndex < 0) return []
  const level = Number(start[0])
  const out = [start]
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line === "0 TRLR") break
    if (Number(line[0]) <= level && !line.startsWith(`${level} `)) {
      // a new record at the top level
      if (line[0] === "0") break
    }
    out.push(line)
  }
  return out
}

describe("familyToGedcom — header and trailer", () => {
  test("emits a GEDCOM 5.5.1 header and trailer", () => {
    const lines = linesOf({})
    expect(lines[0]).toBe("0 HEAD")
    expect(lines).toContain("2 VERS 5.5.1")
    expect(lines).toContain("2 FORM LINEAGE-LINKED")
    expect(lines).toContain("1 CHAR UTF-8")
    expect(lines.at(-1)).toBe("0 TRLR")
  })

  test("stamps the export date at level 1", () => {
    const lines = linesOf({})
    expect(lines).toContain("1 DATE 2 AUG 2026")
  })
})

describe("familyToGedcom — individuals", () => {
  test("maps name, sex, birth and death", () => {
    const people: FamilyData = {
      p1: person({
        id: "p1",
        name: "Henry Tan",
        familyName: "Tan",
        gender: "male",
        dob: "1948-03-02",
        dod: "2019-05-20",
        birthplace: "Penang",
      }),
    }
    const indi = block(linesOf(people), "0 @I1@ INDI")
    expect(indi).toContain("1 NAME Henry /Tan/")
    expect(indi).toContain("1 SEX M")
    expect(indi).toContain("1 BIRT")
    expect(indi).toContain("2 DATE 2 MAR 1948")
    expect(indi).toContain("2 PLAC Penang")
    expect(indi).toContain("1 DEAT")
    expect(indi).toContain("2 DATE 20 MAY 2019")
  })

  test("treats unknown gender as U and female as F", () => {
    const people: FamilyData = {
      a: person({ id: "a", name: "Alex", gender: "other" }),
      b: person({ id: "b", name: "Beth", gender: "female" }),
    }
    const lines = linesOf(people)
    expect(block(lines, "0 @I1@ INDI")).toContain("1 SEX U")
    expect(block(lines, "0 @I2@ INDI")).toContain("1 SEX F")
  })

  test("converts partial dates", () => {
    const people: FamilyData = {
      y: person({ id: "y", name: "Y", dob: "1985" }),
      ym: person({ id: "ym", name: "YM", dob: "1985-04" }),
    }
    const lines = linesOf(people)
    expect(block(lines, "0 @I1@ INDI")).toContain("2 DATE 1985")
    expect(block(lines, "0 @I2@ INDI")).toContain("2 DATE APR 1985")
  })

  test("escapes @ and collapses newlines in values", () => {
    const people: FamilyData = {
      p: person({
        id: "p",
        name: "Jo@hn",
        familyName: "O'Brien",
        birthplace: "New\nYork",
      }),
    }
    const indi = block(linesOf(people), "0 @I1@ INDI")
    expect(
      indi.some((l) => l.startsWith("1 NAME ") && l.includes("Jo@@hn")),
    ).toBe(true)
    expect(indi).toContain("2 PLAC New York")
  })
})

describe("familyToGedcom — families", () => {
  test("links spouses and children from the seed tree", () => {
    const { people } = seedData()
    const lines = linesOf(people)

    // Henry (male) and Mei (female) marry 14 Sep 1971; David is their child.
    const sortedIds = Object.keys(people).sort()
    const indexByName = (name: string) =>
      sortedIds.findIndex((id) => people[id]?.name === name)
    expect(indexByName("Henry Tan")).toBeGreaterThanOrEqual(0)
    expect(indexByName("Mei Ling")).toBeGreaterThanOrEqual(0)
    expect(indexByName("David Tan")).toBeGreaterThanOrEqual(0)

    const famBlocks = lines
      .map((line, index) => ({ line, index }))
      .filter(
        (entry) => entry.line.startsWith("0 @F") && entry.line.endsWith("FAM"),
      )
    expect(famBlocks.length).toBe(2)

    const marriageFam = lines.includes("2 DATE 14 SEP 1971")
    expect(marriageFam).toBe(true)

    // Henry is the husband, Mei the wife, in the family they share.
    const couples = famBlocks.map(({ index }) =>
      lines.slice(index, index + 6).join("\n"),
    )
    const parentCouple = couples.find(
      (blockText) =>
        blockText.includes("1 HUSB @I") && blockText.includes("1 WIFE @I"),
    )
    expect(parentCouple).toBeTruthy()

    // David's INDI references his parents' family as a child (FAMC) and his
    // own family as a spouse (FAMS).
    const davidPointer = `@I${1 + indexByName("David Tan")}@`
    const davidIndi = block(lines, `0 ${davidPointer} INDI`)
    expect(davidIndi.some((l) => l.startsWith("1 FAMC @F"))).toBe(true)
    expect(davidIndi.some((l) => l.startsWith("1 FAMS @F"))).toBe(true)
  })

  test("assigns HUSB/WIFE by gender regardless of id order", () => {
    const wife = person({
      id: "wife",
      name: "W",
      familyName: "",
      gender: "female",
    })
    const husb = person({
      id: "husb",
      name: "H",
      familyName: "",
      gender: "male",
    })
    wife.spouseIds = ["husb"]
    husb.spouseIds = ["wife"]
    const people: FamilyData = { wife, husb }
    const lines = linesOf(people)
    // ids sort to ["husb", "wife"] -> husb=@I1@ (male), wife=@I2@ (female)
    const fam = lines
      .slice(lines.findIndex((l) => l.startsWith("0 @F1@ FAM")))
      .join("\n")
    expect(fam).toContain("1 HUSB @I1@")
    expect(fam).toContain("1 WIFE @I2@")
  })

  test("emits a DIV event for a divorced couple", () => {
    const a = person({ id: "a", name: "A", gender: "male" })
    const b = person({ id: "b", name: "B", gender: "female" })
    a.spouseIds = ["b"]
    b.spouseIds = ["a"]
    a.marriageDates = { b: "2000-05-01" }
    b.marriageDates = { a: "2000-05-01" }
    a.unionStatus = {
      b: { type: "divorced", marriageDate: "2000-05-01", date: "2010-06-10" },
    }
    b.unionStatus = {
      a: { type: "divorced", marriageDate: "2000-05-01", date: "2010-06-10" },
    }
    const people: FamilyData = { a, b }
    const lines = linesOf(people)
    const fam = lines
      .slice(
        lines.findIndex((l) => l.startsWith("0 @F1@ FAM")),
        lines.indexOf("0 TRLR"),
      )
      .join("\n")
    expect(fam).toContain("1 MARR")
    expect(fam).toContain("2 DATE 1 MAY 2000")
    expect(fam).toContain("1 DIV")
    expect(fam).toContain("2 DATE 10 JUN 2010")
  })

  test("records a single-parent family with FAMS and FAMC", () => {
    const parent = person({ id: "parent", name: "P", gender: "male" })
    const child = person({ id: "child", name: "C" })
    child.parents = [{ id: "parent" }]
    const people: FamilyData = { parent, child }
    const lines = linesOf(people)
    // ids sort to ["child", "parent"] -> child=@I1@, parent=@I2@
    const fam = lines
      .slice(
        lines.findIndex((l) => l.startsWith("0 @F1@ FAM")),
        lines.indexOf("0 TRLR"),
      )
      .join("\n")
    expect(fam).toContain("1 HUSB @I2@")
    expect(fam).toContain("1 CHIL @I1@")
    expect(block(lines, "0 @I2@ INDI")).toContain("1 FAMS @F1@")
    expect(block(lines, "0 @I1@ INDI")).toContain("1 FAMC @F1@")
  })

  test("marks an adoptive link with PEDI adopted", () => {
    const bio = person({ id: "bio", name: "Bio", gender: "male" })
    const adopted = person({ id: "adopted", name: "Ad", gender: "female" })
    const kid = person({ id: "kid", name: "K" })
    const people: FamilyData = { bio, adopted, kid }
    kid.parents = [
      { id: "bio", type: "biological" },
      { id: "adopted", type: "adoptive" },
    ]
    const lines = linesOf(people)
    // Kid has two parents of differing types -> no single PEDI.
    const kidPointer = `@I${1 + Object.keys(people).sort().indexOf("kid")}@`
    let kidIndi = block(lines, `0 ${kidPointer} INDI`).join("\n")
    expect(kidIndi.includes("2 PEDI")).toBe(false)

    // Both adoptive -> PEDI adopted.
    kid.parents = [
      { id: "bio", type: "adoptive" },
      { id: "adopted", type: "adoptive" },
    ]
    kidIndi = block(linesOf(people), `0 ${kidPointer} INDI`).join("\n")
    expect(kidIndi).toContain("2 PEDI adopted")
  })
})
