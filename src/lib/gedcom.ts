import type { FamilyData, Gender } from "../types"

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
