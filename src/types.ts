export type Gender = "male" | "female" | "other"

export type ParentLink = {
  id: string
  adopted?: boolean
  type?: ParentChildRelationshipType
}

export type PersonIdentity = {
  id: string
  name: string
  /** ISO date string, e.g. "1985-04-12" */
  dob?: string
  /** Date of death - set when the person is deceased. */
  dod?: string
  gender?: Gender
  location?: string
  /** Compressed data-URL of the uploaded photo. */
  photo?: string
  /** ISO timestamp of the last edit. Set by the sync seam. */
  updatedAt?: string
  /** Owner user id when the record came from the server. */
  ownerId?: string
}

/** The UI projection consumed by layout and sidebar components. */
export type Person = PersonIdentity & {
  parents: ParentLink[]
  spouseIds: string[]
  marriageDates: Record<string, string>
}

export type FamilyData = Record<string, Person>

export type UnionEventType =
  | "relationship_started"
  | "engaged"
  | "married"
  | "civil_union"
  | "domestic_partnership"
  | "separated"
  | "reconciled"
  | "divorced"
  | "annulled"
  | "relationship_ended"

export type ParentChildRelationshipType =
  | "biological"
  | "adoptive"
  | "foster"
  | "guardian"
  | "step"

export type TreeMember = {
  treeId: string
  personId: string
  createdAt: string
  updatedAt: string
}

export type Union = {
  id: string
  firstPersonId: string
  secondPersonId: string
  createdAt: string
  updatedAt: string
}

export type UnionEvent = {
  id: string
  unionId: string
  type: UnionEventType
  eventDate?: string
  createdAt: string
  updatedAt: string
}

export type TreeUnion = {
  treeId: string
  unionId: string
  createdAt: string
  updatedAt: string
}

export type ParentChildRelationship = {
  id: string
  parentPersonId: string
  childPersonId: string
  type: ParentChildRelationshipType
  createdAt: string
  updatedAt: string
}

export type TreeParentChildRelationship = {
  treeId: string
  parentChildRelationshipId: string
  createdAt: string
  updatedAt: string
}

export type NormalizedRelationships = {
  treeMembers: Record<string, TreeMember>
  unions: Record<string, Union>
  unionEvents: Record<string, UnionEvent>
  treeUnions: Record<string, TreeUnion>
  parentChildRelationships: Record<string, ParentChildRelationship>
  treeParentChildRelationships: Record<string, TreeParentChildRelationship>
}

const TERMINAL_UNION_EVENTS = new Set<UnionEventType>([
  "divorced",
  "annulled",
  "relationship_ended",
])

type CreatedRecord = {
  createdAt: string
  id?: string
  treeId?: string
  personId?: string
  unionId?: string
  parentChildRelationshipId?: string
}

function stableRecordKey(record: CreatedRecord): string {
  return (
    record.id
    ?? [
      record.treeId,
      record.personId,
      record.unionId,
      record.parentChildRelationshipId,
    ].join(":")
  )
}

function byCreatedAt(first: CreatedRecord, second: CreatedRecord): number {
  return (
    first.createdAt.localeCompare(second.createdAt)
    || stableRecordKey(first).localeCompare(stableRecordKey(second))
  )
}

export function canonicalPersonPair(
  firstPersonId: string,
  secondPersonId: string,
): [string, string] {
  return firstPersonId < secondPersonId
    ? [firstPersonId, secondPersonId]
    : [secondPersonId, firstPersonId]
}

export function unionIsCurrent(
  unionId: string,
  unionEvents: Record<string, UnionEvent>,
): boolean {
  const latest = Object.values(unionEvents)
    .filter((event) => event.unionId === unionId)
    .sort((first, second) => {
      const firstDate = first.eventDate ?? first.createdAt
      const secondDate = second.eventDate ?? second.createdAt
      return (
        firstDate.localeCompare(secondDate)
        || first.createdAt.localeCompare(second.createdAt)
        || first.id.localeCompare(second.id)
      )
    })
    .at(-1)
  return !latest || !TERMINAL_UNION_EVENTS.has(latest.type)
}

export function marriageDateForUnion(
  unionId: string,
  unionEvents: Record<string, UnionEvent>,
): string | undefined {
  return Object.values(unionEvents)
    .filter((event) => event.unionId === unionId && event.type === "married")
    .sort(byCreatedAt)
    .at(-1)?.eventDate
}

/** Derive one tree's existing UI view from normalized relationship records. */
export function projectTree(
  identities: Record<string, PersonIdentity>,
  relationships: NormalizedRelationships,
  treeId: string,
): FamilyData {
  const family: FamilyData = {}
  const members = Object.values(relationships.treeMembers)
    .filter((member) => member.treeId === treeId)
    .sort(byCreatedAt)

  for (const member of members) {
    const identity = identities[member.personId]
    if (!identity) continue
    family[member.personId] = {
      ...identity,
      parents: [],
      spouseIds: [],
      marriageDates: {},
    }
  }

  const currentUnionByPair = new Map<string, Union>()
  const associatedUnions = Object.values(relationships.treeUnions)
    .filter((association) => association.treeId === treeId)
    .sort(byCreatedAt)
  for (const association of associatedUnions) {
    const union = relationships.unions[association.unionId]
    if (
      !union
      || !family[union.firstPersonId]
      || !family[union.secondPersonId]
      || !unionIsCurrent(union.id, relationships.unionEvents)
    ) {
      continue
    }
    currentUnionByPair.set(
      `${union.firstPersonId}:${union.secondPersonId}`,
      union,
    )
  }

  for (const union of currentUnionByPair.values()) {
    const firstPerson = family[union.firstPersonId]
    const secondPerson = family[union.secondPersonId]
    if (!firstPerson || !secondPerson) continue
    firstPerson.spouseIds.push(secondPerson.id)
    secondPerson.spouseIds.push(firstPerson.id)
    const marriageDate = marriageDateForUnion(
      union.id,
      relationships.unionEvents,
    )
    if (marriageDate) {
      firstPerson.marriageDates[secondPerson.id] = marriageDate
      secondPerson.marriageDates[firstPerson.id] = marriageDate
    }
  }

  const seenParentLinks = new Set<string>()
  const associatedParentRelationships = Object.values(
    relationships.treeParentChildRelationships,
  )
    .filter((association) => association.treeId === treeId)
    .sort(byCreatedAt)
  for (const association of associatedParentRelationships) {
    const relationship =
      relationships.parentChildRelationships[
        association.parentChildRelationshipId
      ]
    const child = relationship ? family[relationship.childPersonId] : undefined
    if (!relationship || !child || !family[relationship.parentPersonId])
      continue
    const key = `${relationship.childPersonId}:${relationship.parentPersonId}`
    if (seenParentLinks.has(key) || child.parents.length >= 2) continue
    seenParentLinks.add(key)
    child.parents.push({
      id: relationship.parentPersonId,
      adopted: relationship.type === "adoptive" || undefined,
      type: relationship.type,
    })
  }

  return family
}

/** Merge the projected members and relationships from multiple trees. */
export function projectTrees(
  identities: Record<string, PersonIdentity>,
  relationships: NormalizedRelationships,
  treeIds: string[],
): FamilyData {
  const output: FamilyData = {}
  for (const treeId of treeIds) {
    for (const [id, person] of Object.entries(
      projectTree(identities, relationships, treeId),
    )) {
      const existing = output[id]
      if (!existing) {
        output[id] = person
        continue
      }
      for (const parent of person.parents) {
        if (!existing.parents.some((link) => link.id === parent.id)) {
          existing.parents.push(parent)
        }
      }
      for (const spouseId of person.spouseIds) {
        if (!existing.spouseIds.includes(spouseId)) {
          existing.spouseIds.push(spouseId)
        }
      }
      Object.assign(existing.marriageDates, person.marriageDates)
    }
  }
  return output
}

export type Relationship =
  | { kind: "root" }
  | {
      kind: "child"
      parentId: string
      otherParentId?: string
      adopted?: boolean
    }
  | { kind: "spouse"; partnerId: string }
  | { kind: "parent"; childId: string; marryExisting?: boolean }

export type PersonInput = {
  name: string
  dob?: string
  dod?: string
  gender?: Gender
  location?: string
  photo?: string
}

export function childrenOf(people: FamilyData, id: string): Person[] {
  return Object.values(people).filter((person) =>
    person.parents.some((link) => link.id === id),
  )
}

export function descendantsOf(people: FamilyData, id: string): Set<string> {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const child of childrenOf(people, current)) {
      if (!seen.has(child.id)) {
        seen.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return seen
}

export function focusFamily(people: FamilyData, focusId: string): FamilyData {
  if (!people[focusId]) return people
  const blood = new Set<string>([focusId, ...ancestorsOf(people, focusId)])
  for (const id of [...blood]) {
    for (const descendant of descendantsOf(people, id)) blood.add(descendant)
  }
  const included = new Set(blood)
  for (const id of blood) {
    for (const spouseId of people[id]?.spouseIds ?? []) {
      if (people[spouseId]) included.add(spouseId)
    }
  }
  const result: FamilyData = {}
  for (const id of included) {
    const person = people[id]
    if (person) result[id] = person
  }
  return result
}

export function ancestorsOf(people: FamilyData, id: string): Set<string> {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const link of people[current]?.parents ?? []) {
      if (people[link.id] && !seen.has(link.id)) {
        seen.add(link.id)
        stack.push(link.id)
      }
    }
  }
  return seen
}
