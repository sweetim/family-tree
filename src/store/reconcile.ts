import {
  canonicalPersonPair,
  type FamilyData,
  type ParentChildRelationship,
} from "../types"
import { type GlobalState, makeDraft } from "./state"
import {
  addMember,
  associateParentChildRelationship,
  associateUnion,
  identityFromPerson,
  personHasWritableTree,
  removeMember,
  removePersonFromTreeRecords,
  treeIsWritable,
} from "./membership"
import { ensureUnion, ensureMarriedEvent, createReplacementUnion } from "./unions"
import { ensureParentChildRelationship } from "./parent-child"

function reconcileTreeData(
  graph: GlobalState,
  treeId: string,
  data: FamilyData,
): void {
  const desiredMemberIds = new Set(Object.keys(data))
  for (const person of Object.values(data)) {
    graph.persons[person.id] = {
      ...graph.persons[person.id],
      ...identityFromPerson(person),
    }
    addMember(graph, treeId, person.id)
  }
  for (const member of Object.values(graph.treeMembers)) {
    if (member.treeId === treeId && !desiredMemberIds.has(member.personId)) {
      removePersonFromTreeRecords(graph, member.personId, treeId)
    }
  }

  const desiredUnionIds = new Set<string>()
  const seenPairs = new Set<string>()
  for (const person of Object.values(data)) {
    for (const spouseId of person.spouseIds) {
      if (!data[spouseId] || spouseId === person.id) continue
      const [firstPersonId, secondPersonId] = canonicalPersonPair(
        person.id,
        spouseId,
      )
      const pairKey = `${firstPersonId}:${secondPersonId}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      const union = ensureUnion(graph, firstPersonId, secondPersonId)
      desiredUnionIds.add(union.id)
      associateUnion(graph, treeId, union.id)
      const marriageEvent = ensureMarriedEvent(graph, union.id)
      const eventDate =
        person.marriageDates[spouseId]
        ?? data[spouseId]?.marriageDates[person.id]
      if (marriageEvent.eventDate !== eventDate) {
        graph.unionEvents[marriageEvent.id] = {
          ...marriageEvent,
          eventDate,
        }
      }
    }
  }
  for (const [key, association] of Object.entries(graph.treeUnions)) {
    if (
      association.treeId === treeId
      && !desiredUnionIds.has(association.unionId)
    ) {
      delete graph.treeUnions[key]
    }
  }

  const desiredParentRelationshipIds = new Set<string>()
  for (const child of Object.values(data)) {
    for (const parent of child.parents) {
      if (!data[parent.id] || parent.id === child.id) continue
      const desiredType =
        parent.type ?? (parent.adopted ? "adoptive" : "biological")
      const relationship = ensureParentChildRelationship(
        graph,
        parent.id,
        child.id,
        desiredType,
      )
      if (!relationship) {
        throw new Error(
          "Parent relationships would create a cycle or third parent",
        )
      }
      if (relationship.type !== desiredType) {
        graph.parentChildRelationships[relationship.id] = {
          ...relationship,
          type: desiredType,
        }
      }
      desiredParentRelationshipIds.add(relationship.id)
      associateParentChildRelationship(graph, treeId, relationship.id)
    }
  }
  for (const [key, association] of Object.entries(
    graph.treeParentChildRelationships,
  )) {
    if (
      association.treeId === treeId
      && !desiredParentRelationshipIds.has(
        association.parentChildRelationshipId,
      )
    ) {
      delete graph.treeParentChildRelationships[key]
    }
  }
}

/** Merge identities by replacing writable-tree associations, never fact endpoints. */
export function mergePersonRecords(
  previous: GlobalState,
  keepId: string,
  dropId: string,
): GlobalState {
  const keep = previous.persons[keepId]
  const drop = previous.persons[dropId]
  if (
    keepId === dropId
    || !keep
    || !drop
    || !personHasWritableTree(previous, keepId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  draft.persons[keepId] = {
    id: keepId,
    name: keep.name || drop.name,
    familyName: keep.familyName || drop.familyName,
    dob: keep.dob ?? drop.dob,
    dod: keep.dod ?? drop.dod,
    gender: keep.gender ?? drop.gender,
    birthplace: keep.birthplace ?? drop.birthplace,
    photo: keep.photo ?? drop.photo,
    ownerId: keep.ownerId ?? drop.ownerId,
  }
  delete draft.persons[dropId]

  for (const member of Object.values(previous.treeMembers)) {
    if (
      member.personId !== dropId
      || !treeIsWritable(previous, member.treeId)
    ) {
      continue
    }
    addMember(draft, member.treeId, keepId)
    removeMember(draft, member.treeId, dropId)
  }

  const replacementUnions = new Map<string, ReturnType<typeof ensureUnion>>()
  const unionAssociations = Object.entries(previous.treeUnions).sort(
    ([firstKey], [secondKey]) => firstKey.localeCompare(secondKey),
  )
  for (const [associationKey, association] of unionAssociations) {
    if (!treeIsWritable(previous, association.treeId)) continue
    const union = previous.unions[association.unionId]
    if (
      !union
      || (union.firstPersonId !== dropId && union.secondPersonId !== dropId)
    ) {
      continue
    }
    delete draft.treeUnions[associationKey]
    const firstPersonId =
      union.firstPersonId === dropId ? keepId : union.firstPersonId
    const secondPersonId =
      union.secondPersonId === dropId ? keepId : union.secondPersonId
    if (firstPersonId === secondPersonId) continue
    const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
    const pairKey = `${first}:${second}`
    let replacement = replacementUnions.get(pairKey)
    if (!replacement) {
      replacement = createReplacementUnion(draft, union, first, second)
      replacementUnions.set(pairKey, replacement)
    }
    associateUnion(draft, association.treeId, replacement.id)
  }

  const replacementParentRelationships = new Map<
    string,
    ParentChildRelationship
  >()
  const parentAssociations = Object.entries(
    previous.treeParentChildRelationships,
  ).sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
  for (const [associationKey, association] of parentAssociations) {
    if (!treeIsWritable(previous, association.treeId)) continue
    const relationship =
      previous.parentChildRelationships[association.parentChildRelationshipId]
    if (
      !relationship
      || (relationship.parentPersonId !== dropId
        && relationship.childPersonId !== dropId)
    ) {
      continue
    }
    delete draft.treeParentChildRelationships[associationKey]
    const parentPersonId =
      relationship.parentPersonId === dropId
        ? keepId
        : relationship.parentPersonId
    const childPersonId =
      relationship.childPersonId === dropId
        ? keepId
        : relationship.childPersonId
    if (parentPersonId === childPersonId) continue
    const pairKey = `${parentPersonId}:${childPersonId}`
    let replacement = replacementParentRelationships.get(pairKey)
    if (!replacement) {
      replacement = ensureParentChildRelationship(
        draft,
        parentPersonId,
        childPersonId,
        relationship.type,
      )
      if (!replacement) continue
      replacementParentRelationships.set(pairKey, replacement)
    }
    associateParentChildRelationship(draft, association.treeId, replacement.id)
  }
  return draft
}

export { reconcileTreeData }
