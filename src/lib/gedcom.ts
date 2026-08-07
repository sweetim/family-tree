import type { FamilyData, Gender, ParentChildRelationshipType } from "../types"

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const

const TERMINAL_UNION = new Set(["divorced", "annulled", "relationship_ended"])

const PEDI_BY_TYPE: Record<string, string> = {
  adoptive: "adopted",
  foster: "foster",
  guardian: "guardian",
  step: "step",
}

type Family = {
  key: string
  parents: string[]
  children: string[]
  hasSpouses: boolean
}

/** Sanitize a value for a GEDCOM line: collapse newlines/tabs, escape `@`,
 *  and trim. GEDCOM pointers are delimited by `@`, so a literal `@` in data is
 *  escaped as `@@` per the spec. */
function escapeValue(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/@/g, "@@")
    .trim()
}

/** Convert a (possibly partial) ISO date into a GEDCOM date phrase.
 *  "1985-04-12" -> "12 APR 1985", "1985-04" -> "APR 1985", "1985" -> "1985".
 *  Returns undefined when the value is not a recognizable date. */
function gedcomDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim())
  if (!match) return undefined
  const year = match[1] as string
  const month = match[2] ? Number(match[2]) : 0
  const day = match[3] ? Number(match[3]) : 0
  if (month >= 1 && month <= 12) {
    if (day >= 1 && day <= 31) return `${day} ${MONTHS[month - 1]} ${year}`
    return `${MONTHS[month - 1]} ${year}`
  }
  return year
}

function sexFor(gender: Gender | undefined): string {
  if (gender === "male") return "M"
  if (gender === "female") return "F"
  return "U"
}

/** Build the GEDCOM NAME value "<given> /<surname>/". The app stores the full
 *  display name (which usually already ends with the surname), so a trailing
 *  surname is stripped from the given part to avoid duplication. */
function gedcomName(name: string, familyName: string): string {
  const trimmedName = escapeValue(name)
  const trimmedFamily = escapeValue(familyName).replace(/\//g, " ").trim()
  if (!trimmedFamily) return trimmedName
  const lowerName = trimmedName.toLowerCase()
  const lowerFamily = trimmedFamily.toLowerCase()
  if (lowerName === lowerFamily) return `/${trimmedFamily}/`
  if (lowerName.endsWith(` ${lowerFamily}`)) {
    const given = trimmedName.slice(
      0,
      trimmedName.length - trimmedFamily.length - 1,
    )
    return `${given} /${trimmedFamily}/`
  }
  return `${trimmedName} /${trimmedFamily}/`
}

/** Assign HUSB/WIFE roles to a family's parents. Male -> HUSB, female -> WIFE;
 *  when ambiguous (same/unknown gender, or a single parent) the order is kept
 *  stable. A lone female parent is recorded as WIFE. */
function rolesFor(
  parents: string[],
  people: FamilyData,
): { husb?: string; wife?: string } {
  if (parents.length === 1) {
    const only = parents[0]
    return only && people[only]?.gender === "female"
      ? { wife: only }
      : { husb: only }
  }
  const [first, second] = parents as [string, string]
  const firstGender = first ? people[first]?.gender : undefined
  const secondGender = second ? people[second]?.gender : undefined
  if (firstGender === "male" && secondGender !== "male") {
    return { husb: first, wife: second }
  }
  if (secondGender === "male" && firstGender !== "male") {
    return { husb: second, wife: first }
  }
  if (firstGender === "female" && secondGender !== "female") {
    return { husb: second, wife: first }
  }
  return { husb: first, wife: second }
}

/** PEDI tag for a child's FAMC, when every parent link into this family shares
 *  the same non-biological type. Biological links emit no tag. */
function pediFor(
  person: FamilyData[string],
  familyParents: string[],
): string | undefined {
  const types = new Set(
    person.parents
      .filter((link) => familyParents.includes(link.id))
      .map((link) => link.type ?? "biological"),
  )
  if (types.size !== 1) return undefined
  const [type] = types
  return type ? PEDI_BY_TYPE[type] : undefined
}

/** Serialize a family tree to GEDCOM 5.5.1 (lineage-linked, UTF-8). */
export function familyToGedcom(
  people: FamilyData,
  options?: { date?: Date },
): string {
  const exportedAt = options?.date ?? new Date()
  const ids = Object.keys(people).sort()
  const personPointer = new Map<string, string>()
  ids.forEach((id, index) => {
    personPointer.set(id, `@I${index + 1}@`)
  })

  const families = new Map<string, Family>()
  const ensureFamily = (parentIds: string[], asSpouses: boolean): Family => {
    const parents = [...new Set(parentIds.filter((id) => people[id]))].sort()
    const key = parents.join("\n")
    let family = families.get(key)
    if (!family) {
      family = { key, parents, children: [], hasSpouses: false }
      families.set(key, family)
    }
    if (asSpouses && parents.length === 2) family.hasSpouses = true
    return family
  }

  // Couple families: a childless spouse pair still gets a FAM record.
  for (const id of ids) {
    const person = people[id]
    if (!person) continue
    for (const spouseId of person.spouseIds) {
      if (spouseId !== id && people[spouseId]) {
        ensureFamily([id, spouseId], true)
      }
    }
  }

  // Group children by their parent set; remember each child's origin family.
  const childFamily = new Map<string, Family>()
  for (const id of ids) {
    const person = people[id]
    if (!person) continue
    const parentIds = person.parents
      .map((link) => link.id)
      .filter((parentId) => people[parentId])
    if (parentIds.length === 0) continue
    const family = ensureFamily(parentIds, false)
    if (!family.children.includes(id)) family.children.push(id)
    childFamily.set(id, family)
  }

  // Families each person parents (for FAMS), in stable order.
  const personFamilies = new Map<string, Family[]>()
  for (const family of families.values()) {
    for (const parentId of family.parents) {
      const list = personFamilies.get(parentId) ?? []
      list.push(family)
      personFamilies.set(parentId, list)
    }
  }
  for (const list of personFamilies.values()) {
    list.sort((first, second) => first.key.localeCompare(second.key))
  }

  const familyList = [...families.values()].sort((first, second) =>
    first.key.localeCompare(second.key),
  )
  const familyPointer = new Map<string, string>()
  familyList.forEach((family, index) => {
    familyPointer.set(family.key, `@F${index + 1}@`)
  })

  const lines: string[] = []
  lines.push("0 HEAD")
  lines.push("1 SOUR FamiKi")
  lines.push("2 NAME FamiKi")
  lines.push("2 VERS 1.0")
  lines.push("1 GEDC")
  lines.push("2 VERS 5.5.1")
  lines.push("2 FORM LINEAGE-LINKED")
  lines.push(`1 DATE ${gedcomDate(isoDate(exportedAt))}`)
  lines.push("1 CHAR UTF-8")

  for (const id of ids) {
    const person = people[id]
    if (!person) continue
    lines.push(`0 ${personPointer.get(id)} INDI`)
    lines.push(`1 NAME ${gedcomName(person.name, person.familyName)}`)
    lines.push(`1 SEX ${sexFor(person.gender)}`)
    if (person.dob || person.birthplace) {
      lines.push("1 BIRT")
      const birthDate = gedcomDate(person.dob)
      if (birthDate) lines.push(`2 DATE ${birthDate}`)
      if (person.birthplace) {
        lines.push(`2 PLAC ${escapeValue(person.birthplace)}`)
      }
    }
    if (person.dod) {
      lines.push("1 DEAT")
      const deathDate = gedcomDate(person.dod)
      if (deathDate) lines.push(`2 DATE ${deathDate}`)
    }
    for (const family of personFamilies.get(id) ?? []) {
      lines.push(`1 FAMS ${familyPointer.get(family.key)}`)
    }
    const origin = childFamily.get(id)
    if (origin) {
      lines.push(`1 FAMC ${familyPointer.get(origin.key)}`)
      const pedi = person ? pediFor(person, origin.parents) : undefined
      if (pedi) lines.push(`2 PEDI ${pedi}`)
    }
  }

  for (const family of familyList) {
    lines.push(`0 ${familyPointer.get(family.key)} FAM`)
    const roles = rolesFor(family.parents, people)
    if (roles.husb) lines.push(`1 HUSB ${personPointer.get(roles.husb)}`)
    if (roles.wife) lines.push(`1 WIFE ${personPointer.get(roles.wife)}`)

    if (family.parents.length === 2) {
      const [first, second] = family.parents as [string, string]
      const firstPerson = first ? people[first] : undefined
      const secondPerson = second ? people[second] : undefined
      const marriageDate =
        firstPerson?.marriageDates?.[second]
        ?? secondPerson?.marriageDates?.[first]
      const status =
        firstPerson?.unionStatus?.[second] ?? secondPerson?.unionStatus?.[first]
      if (family.hasSpouses || marriageDate) {
        lines.push("1 MARR")
        const date = gedcomDate(marriageDate)
        if (date) lines.push(`2 DATE ${date}`)
      }
      if (status && TERMINAL_UNION.has(status.type)) {
        lines.push("1 DIV")
        const date = gedcomDate(status.date)
        if (date) lines.push(`2 DATE ${date}`)
      }
    }

    for (const childId of family.children) {
      lines.push(`1 CHIL ${personPointer.get(childId)}`)
    }
  }

  lines.push("0 TRLR")
  return `${lines.join("\n")}\n`
}

/** Local YYYY-MM-DD for the export date stamp (not a full timestamp). */
function isoDate(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  )
  return utc.toISOString().slice(0, 10)
}

const MONTH_INDEX: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

/** Map a GEDCOM FAMC PEDI value to the app's parent-relationship type.
 *  Biological (or any unrecognized value, including "birth"/"sealed") is the
 *  default. */
const PEDI_TYPE: Record<string, ParentChildRelationshipType> = {
  adopted: "adoptive",
  foster: "foster",
  guardian: "guardian",
  step: "step",
}

/** True only for an exact `YYYY-MM-DD` with a valid month/day, mirroring the
 *  JSON import invariant: marriage dates must be exact, so partial GEDCOM
 *  dates are dropped rather than carried as non-conformant values. */
function isExactIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return day <= (daysInMonth[month - 1] ?? 0)
}

/** Parse a GEDCOM date phrase into an ISO date string, tolerating the common
 *  qualifiers (ABT, EST, BEF, AFT, …) and Gregorian calendar markers.
 *  "12 APR 1985" -> "1985-04-12", "APR 1985" -> "1985-04", "1985" -> "1985". */
function parseGedcomDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value.replace(/\([^)]*\)/g, " ").trim()
  if (!cleaned) return undefined
  let day = 0
  let month = 0
  let year = ""
  for (const token of cleaned.split(/\s+/)) {
    const upper = token.replace(/\.+$/, "").toUpperCase()
    if (upper in MONTH_INDEX) {
      month = MONTH_INDEX[upper] ?? 0
    } else if (/^\d{3,4}$/.test(token)) {
      year = token
    } else if (/^\d{1,2}$/.test(token) && !day) {
      day = Number(token)
    }
  }
  if (!year) return undefined
  if (month) {
    const monthString = String(month).padStart(2, "0")
    if (day >= 1 && day <= 31) {
      return `${year}-${monthString}-${String(day).padStart(2, "0")}`
    }
    return `${year}-${monthString}`
  }
  return year
}

/** Split a GEDCOM NAME value "<given> /<surname>/" into the app's display name
 *  (which already includes the surname) and the standalone family name. Names
 *  without slashes are treated as a display name with no family name. */
function parseName(value: string): { name: string; familyName: string } {
  const open = value.indexOf("/")
  const close = value.lastIndexOf("/")
  if (open === -1 || close <= open) {
    return { name: value.trim() || "?", familyName: "" }
  }
  const familyName = value.slice(open + 1, close).trim()
  const given = `${value.slice(0, open)} ${value.slice(close + 1)}`.trim()
  const name =
    [given, familyName].filter(Boolean).join(" ") || familyName || "?"
  return { name, familyName }
}

function parseGender(sex: string | undefined): Gender | undefined {
  const value = sex?.trim().toUpperCase()
  if (value === "M") return "male"
  if (value === "F") return "female"
  return undefined
}

type RawLine = { level: number; xref?: string; tag: string; value: string }

type RawRecord = { tag: string; xref?: string; lines: RawLine[] }

/** Parse GEDCOM text into flat lines, splitting each into level, optional
 *  pointer (`@xref@`), tag, and value. */
function parseRawLines(text: string): RawLine[] {
  const out: RawLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const match = /^(\d+)\s+(.*)$/.exec(raw)
    if (!match) continue
    const level = Number(match[1])
    let rest = match[2] ?? ""
    let xref: string | undefined
    const xrefMatch = /^(@[^@]+@)\s+(.*)$/.exec(rest)
    if (xrefMatch) {
      xref = xrefMatch[1]
      rest = xrefMatch[2] ?? ""
    }
    const space = rest.indexOf(" ")
    out.push({
      level,
      xref,
      tag: space === -1 ? rest : rest.slice(0, space),
      value: space === -1 ? "" : rest.slice(space + 1),
    })
  }
  return out
}

/** Group flat lines into level-0 records (INDI/FAM/HEAD/…), each carrying its
 *  nested sub-lines. */
function readRecords(text: string): RawRecord[] {
  const records: RawRecord[] = []
  let current: RawRecord | null = null
  for (const line of parseRawLines(text)) {
    if (line.level === 0) {
      if (current) records.push(current)
      current = { tag: line.tag, xref: line.xref, lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) records.push(current)
  return records
}

type IndiRecord = {
  name?: string
  sex?: string
  birthDate?: string
  birthPlace?: string
  deathDate?: string
  /** The FAMC pointer currently being read, so its `2 PEDI` can be attached. */
  famcFamily?: string
  /** Each child-of family pointer -> its PEDI type (or undefined/biological). */
  famc: Map<string, string | undefined>
}

function parseIndi(record: RawRecord): IndiRecord {
  const result: IndiRecord = { famc: new Map() }
  let context: string | null = null
  for (const line of record.lines) {
    if (line.level === 1) {
      context = line.tag
      switch (line.tag) {
        case "NAME":
          result.name = line.value
          break
        case "SEX":
          result.sex = line.value
          break
        case "FAMC":
          if (line.value) {
            result.famcFamily = line.value
            result.famc.set(line.value, undefined)
          }
          break
      }
    } else if (line.level === 2 && context) {
      if (context === "BIRT" && line.tag === "DATE") {
        result.birthDate = parseGedcomDate(line.value)
      } else if (context === "BIRT" && line.tag === "PLAC") {
        result.birthPlace = line.value.trim() || undefined
      } else if (context === "DEAT" && line.tag === "DATE") {
        result.deathDate = parseGedcomDate(line.value)
      } else if (
        context === "FAMC"
        && line.tag === "PEDI"
        && result.famcFamily
      ) {
        result.famc.set(
          result.famcFamily,
          line.value.trim().toLowerCase() || undefined,
        )
      }
    }
  }
  return result
}

type FamRecord = {
  xref: string
  parents: string[]
  children: string[]
  marriageDate?: string
}

function parseFam(record: RawRecord): FamRecord {
  const result: FamRecord = {
    xref: record.xref ?? "",
    parents: [],
    children: [],
  }
  let context: string | null = null
  for (const line of record.lines) {
    if (line.level === 1) {
      context = line.tag
      if (
        (line.tag === "HUSB" || line.tag === "WIFE")
        && line.value
        && !result.parents.includes(line.value)
      ) {
        result.parents.push(line.value)
      } else if (
        line.tag === "CHIL"
        && line.value
        && !result.children.includes(line.value)
      ) {
        result.children.push(line.value)
      }
    } else if (line.level === 2 && context === "MARR" && line.tag === "DATE") {
      result.marriageDate = parseGedcomDate(line.value)
    }
  }
  return result
}

function dedupePreservingOrder(values: string[]): string[] {
  return [...new Set(values)]
}

/** Record a spouse link between two people, with the marriage date set on both
 *  sides only when it is an exact ISO date (the app's stored invariant). */
function linkSpouses(
  family: FamilyData,
  firstId: string,
  secondId: string,
  marriageDate: string | undefined,
): void {
  if (firstId === secondId) return
  const first = family[firstId]
  const second = family[secondId]
  if (!first || !second) return
  if (!first.spouseIds.includes(secondId)) first.spouseIds.push(secondId)
  if (!second.spouseIds.includes(firstId)) second.spouseIds.push(firstId)
  if (marriageDate && isExactIsoDate(marriageDate)) {
    first.marriageDates[secondId] = marriageDate
    second.marriageDates[firstId] = marriageDate
  }
}

/** Parse a GEDCOM 5.5.1 document into {@link FamilyData}. Assigns fresh,
 *  URL-safe ids to each individual (GEDCOM pointers like `@I1@` are not used as
 *  ids). Relationships come from FAM records; the app's create/seed path does
 *  not model divorce, so DIV events are intentionally ignored. Throws when the
 *  document contains no individuals. The result still needs invariant
 *  validation (e.g. `validateImportedFamily`) before it is stored. */
export function gedcomToFamily(text: string): FamilyData {
  const individuals = new Map<string, IndiRecord>()
  const families = new Map<string, FamRecord>()
  for (const record of readRecords(text)) {
    if (record.tag === "INDI" && record.xref) {
      individuals.set(record.xref, parseIndi(record))
    } else if (record.tag === "FAM" && record.xref) {
      families.set(record.xref, parseFam(record))
    }
  }
  if (individuals.size === 0) {
    throw new Error("GEDCOM file contains no individuals")
  }

  const idByXref = new Map<string, string>()
  for (const xref of individuals.keys()) {
    idByXref.set(xref, crypto.randomUUID())
  }

  const family: FamilyData = {}
  for (const [xref, record] of individuals) {
    const id = idByXref.get(xref)
    if (!id) continue
    const { name, familyName } = parseName(record.name ?? "")
    family[id] = {
      id,
      name,
      familyName,
      gender: parseGender(record.sex),
      dob: record.birthDate,
      birthplace: record.birthPlace,
      dod: record.deathDate,
      parents: [],
      spouseIds: [],
      marriageDates: {},
    }
  }

  for (const fam of families.values()) {
    const parentIds = dedupePreservingOrder(
      fam.parents
        .map((xref) => idByXref.get(xref))
        .filter((id): id is string => !!id),
    )
    for (const childXref of fam.children) {
      const childId = idByXref.get(childXref)
      const child = childId ? family[childId] : undefined
      if (!child) continue
      const pedi = individuals.get(childXref)?.famc.get(fam.xref)
      const type: ParentChildRelationshipType = pedi
        ? (PEDI_TYPE[pedi] ?? "biological")
        : "biological"
      for (const parentId of parentIds) {
        if (parentId === childId || child.parents.length >= 2) break
        if (child.parents.some((link) => link.id === parentId)) continue
        child.parents.push({ id: parentId, type })
      }
    }
    if (parentIds.length === 2) {
      const firstParentId = parentIds[0]
      const secondParentId = parentIds[1]
      if (firstParentId && secondParentId) {
        linkSpouses(family, firstParentId, secondParentId, fam.marriageDate)
      }
    }
  }

  return family
}
