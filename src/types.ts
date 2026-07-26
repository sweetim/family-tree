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
  /** Latest union status per partner, keyed by partner id. Populated for
   *  every tree-associated union regardless of currency, so divorced couples
   *  remain editable even after they leave `spouseIds`. */
  unionStatus?: Record<string, UnionStatus>
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

/** UI-facing summary of a couple's union: its latest event plus the
 *  marriage date, so panels can show/edit divorce without touching the raw
 *  event list. */
export type UnionStatus = {
  /** Latest event type for this union (e.g. "married", "divorced"). */
  type: UnionEventType
  /** Date of the marriage event, if one exists. */
  marriageDate?: string
  /** Date of the latest event (e.g. divorce date), if any. */
  date?: string
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

function byEventDate(first: UnionEvent, second: UnionEvent): number {
  const firstDate = first.eventDate ?? first.createdAt
  const secondDate = second.eventDate ?? second.createdAt
  return (
    firstDate.localeCompare(secondDate)
    || first.createdAt.localeCompare(second.createdAt)
    || first.id.localeCompare(second.id)
  )
}

export function latestEventForUnion(
  unionId: string,
  unionEvents: Record<string, UnionEvent>,
): UnionEvent | undefined {
  return Object.values(unionEvents)
    .filter((event) => event.unionId === unionId)
    .sort(byEventDate)
    .at(-1)
}

export function isTerminalUnionEvent(type: UnionEventType): boolean {
  return TERMINAL_UNION_EVENTS.has(type)
}

export function unionIsCurrent(
  unionId: string,
  unionEvents: Record<string, UnionEvent>,
): boolean {
  const latest = latestEventForUnion(unionId, unionEvents)
  return !latest || !TERMINAL_UNION_EVENTS.has(latest.type)
}

function marriageDateForUnion(
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

  // Project union status for every tree-associated union (current or not),
  // keyed per partner. This keeps divorced couples editable from the
  // marriage panel even though they no longer appear in `spouseIds`.
  const latestUnionByPair = new Map<string, Union>()
  for (const association of associatedUnions) {
    const union = relationships.unions[association.unionId]
    if (
      !union
      || !family[union.firstPersonId]
      || !family[union.secondPersonId]
    ) {
      continue
    }
    const key = `${union.firstPersonId}:${union.secondPersonId}`
    const existing = latestUnionByPair.get(key)
    if (!existing || byCreatedAt(union, existing) > 0) {
      latestUnionByPair.set(key, union)
    }
  }
  for (const union of latestUnionByPair.values()) {
    const latest = latestEventForUnion(union.id, relationships.unionEvents)
    if (!latest) continue
    const status: UnionStatus = {
      type: latest.type,
      date: isTerminalUnionEvent(latest.type) ? latest.eventDate : undefined,
      marriageDate: marriageDateForUnion(union.id, relationships.unionEvents),
    }
    const firstPerson = family[union.firstPersonId]
    const secondPerson = family[union.secondPersonId]
    if (!firstPerson || !secondPerson) continue
    ;(firstPerson.unionStatus ??= {})[secondPerson.id] = status
    ;(secondPerson.unionStatus ??= {})[firstPerson.id] = status
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
      if (person.unionStatus) {
        existing.unionStatus = {
          ...existing.unionStatus,
          ...person.unionStatus,
        }
      }
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

/**
 * A "married-in" spouse: someone who joined this tree through marriage and
 * brought no ancestry of their own into it. They have no parents here, but at
 * least one of their in-tree spouses has parents here — i.e. they married into
 * an existing bloodline. The top/founding couple (both without parents) is
 * intentionally excluded, so the top of a tree can still be extended upward.
 */
export function isMarriedInSpouse(people: FamilyData, id: string): boolean {
  const person = people[id]
  if (!person) return false
  if (person.parents.some((link) => people[link.id])) return false
  return person.spouseIds.some((spouseId) => {
    const spouse = people[spouseId]
    return !!spouse && spouse.parents.some((link) => people[link.id])
  })
}
