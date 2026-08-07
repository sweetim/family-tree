import {
  type FamilyData,
  type ParentChildRelationshipType,
  type Person,
} from "../types"

const ASCII_ID = /^[\x21-\x7e]+$/
const PARENT_RELATIONSHIP_TYPES = new Set<ParentChildRelationshipType>([
  "biological",
  "adoptive",
  "foster",
  "guardian",
  "step",
])

function isExactIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
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

export function validateImportedFamily(data: FamilyData): FamilyData {
  const personIds = new Set(Object.keys(data))
  for (const [recordId, value] of Object.entries(data)) {
    const person = value as Person | null | undefined
    if (!person || typeof person !== "object") {
      throw new Error("Every imported member must be an object")
    }
    if (
      !ASCII_ID.test(recordId)
      || typeof person.id !== "string"
      || person.id !== recordId
      || !ASCII_ID.test(person.id)
    ) {
      throw new Error("Imported member IDs must be matching nonempty ASCII")
    }
    if (typeof person.name !== "string") {
      throw new Error("Every imported member must have a name")
    }
    if (!Array.isArray(person.parents) || person.parents.length > 2) {
      throw new Error("Imported members may have at most two parents")
    }
    if (!Array.isArray(person.spouseIds)) {
      throw new Error("Imported spouse IDs must be an array")
    }
    if (
      !person.marriageDates
      || typeof person.marriageDates !== "object"
      || Array.isArray(person.marriageDates)
    ) {
      throw new Error("Imported marriage dates must be an object")
    }

    const parentIds = new Set<string>()
    for (const parent of person.parents) {
      if (
        !parent
        || typeof parent !== "object"
        || typeof parent.id !== "string"
        || !personIds.has(parent.id)
        || parent.id === person.id
        || parentIds.has(parent.id)
      ) {
        throw new Error("Imported parent references must be unique members")
      }
      if (parent.adopted !== undefined && typeof parent.adopted !== "boolean") {
        throw new Error("Imported adopted values must be boolean")
      }
      if (
        parent.type !== undefined
        && !PARENT_RELATIONSHIP_TYPES.has(parent.type)
      ) {
        throw new Error("Imported parent relationship type is invalid")
      }
      if (
        (parent.adopted === true
          && parent.type !== undefined
          && parent.type !== "adoptive")
        || (parent.adopted === false && parent.type === "adoptive")
      ) {
        throw new Error("Imported adopted value conflicts with parent type")
      }
      parentIds.add(parent.id)
    }

    const spouseIds = new Set<string>()
    for (const spouseId of person.spouseIds) {
      if (
        typeof spouseId !== "string"
        || !personIds.has(spouseId)
        || spouseId === person.id
        || spouseIds.has(spouseId)
      ) {
        throw new Error("Imported spouse references must be unique members")
      }
      spouseIds.add(spouseId)
    }
    for (const [spouseId, marriageDate] of Object.entries(
      person.marriageDates,
    )) {
      if (
        !spouseIds.has(spouseId)
        || typeof marriageDate !== "string"
        || !isExactIsoDate(marriageDate)
      ) {
        throw new Error("Imported marriage dates must reference a spouse")
      }
    }
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (personId: string): void => {
    if (visiting.has(personId)) {
      throw new Error("Imported parent relationships must not contain cycles")
    }
    if (visited.has(personId)) return
    visiting.add(personId)
    for (const parent of data[personId]?.parents ?? []) visit(parent.id)
    visiting.delete(personId)
    visited.add(personId)
  }
  for (const personId of personIds) visit(personId)
  return data
}

export function normalizeImport(data: Record<string, unknown>): FamilyData {
  if (Array.isArray(data)) throw new Error("Imported family must be an object")
  const family = Object.fromEntries(
    Object.entries(data).map(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Every imported member must be an object")
      }
      const person = value as Person
      return [id, { ...person, marriageDates: person.marriageDates ?? {} }]
    }),
  ) as FamilyData
  return validateImportedFamily(family)
}
