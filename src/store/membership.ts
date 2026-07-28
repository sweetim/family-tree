import { type Person, type PersonIdentity, unionIsCurrent } from "../types"
import {
  type GlobalState,
  makeDraft,
  now,
  type TreeMeta,
  treeMemberKey,
  treeParentChildRelationshipKey,
  treeUnionKey,
} from "./state"

export function treeIsWritable(graph: GlobalState, treeId: string): boolean {
  const tree = graph.index.find((candidate) => candidate.id === treeId)
  return !!tree && tree.role !== "viewer"
}

export function personHasWritableTree(
  graph: GlobalState,
  personId: string,
): boolean {
  return Object.values(graph.treeMembers).some(
    (member) =>
      member.personId === personId && treeIsWritable(graph, member.treeId),
  )
}

export function hasMember(
  graph: GlobalState,
  treeId: string,
  personId: string,
): boolean {
  return !!graph.treeMembers[treeMemberKey(treeId, personId)]
}

export function addMember(
  graph: GlobalState,
  treeId: string,
  personId: string,
): void {
  const key = treeMemberKey(treeId, personId)
  if (graph.treeMembers[key]) return
  const timestamp = now()
  graph.treeMembers[key] = {
    treeId,
    personId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function removeMember(
  graph: GlobalState,
  treeId: string,
  personId: string,
): void {
  delete graph.treeMembers[treeMemberKey(treeId, personId)]
}

export function addMemberWithCurrentSpouses(
  graph: GlobalState,
  treeId: string,
  personId: string,
): void {
  addMember(graph, treeId, personId)
  for (const union of Object.values(graph.unions)) {
    if (!unionIsCurrent(union.id, graph.unionEvents)) continue
    const spouseId =
      union.firstPersonId === personId
        ? union.secondPersonId
        : union.secondPersonId === personId
          ? union.firstPersonId
          : undefined
    if (!spouseId) continue
    addMember(graph, treeId, spouseId)
    associateUnion(graph, treeId, union.id)
  }
}

export function associateUnion(
  graph: GlobalState,
  treeId: string,
  unionId: string,
): void {
  const key = treeUnionKey(treeId, unionId)
  if (graph.treeUnions[key]) return
  const timestamp = now()
  graph.treeUnions[key] = {
    treeId,
    unionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function associateParentChildRelationship(
  graph: GlobalState,
  treeId: string,
  parentChildRelationshipId: string,
): void {
  const key = treeParentChildRelationshipKey(treeId, parentChildRelationshipId)
  if (graph.treeParentChildRelationships[key]) return
  const timestamp = now()
  graph.treeParentChildRelationships[key] = {
    treeId,
    parentChildRelationshipId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function treesWithMember(
  graph: GlobalState,
  personId: string,
  excludeTreeId?: string,
): string[] {
  return graph.index
    .filter(
      (tree) =>
        tree.id !== excludeTreeId
        && treeIsWritable(graph, tree.id)
        && hasMember(graph, tree.id, personId),
    )
    .map((tree) => tree.id)
}

export function treesContainingAll(
  graph: GlobalState,
  personIds: string[],
  excludeTreeId?: string,
): string[] {
  return graph.index
    .filter(
      (tree) =>
        tree.id !== excludeTreeId
        && treeIsWritable(graph, tree.id)
        && personIds.every((personId) => hasMember(graph, tree.id, personId)),
    )
    .map((tree) => tree.id)
}

/**
 * Finds the "ancestor family" of a person: another tree (not the current one)
 * that contains both the person and at least one of their parents — i.e. the
 * family their ancestry lives in. Returns the earliest such tree, or undefined
 * when none exists (including when the person has no parents at all).
 */
export function findAncestorTree(
  graph: GlobalState,
  personId: string,
  currentTreeId: string,
): TreeMeta | undefined {
  const parentIds = Object.values(graph.parentChildRelationships)
    .filter((relationship) => relationship.childPersonId === personId)
    .map((relationship) => relationship.parentPersonId)
  if (parentIds.length === 0) return undefined
  const candidates = graph.index.filter(
    (tree) =>
      tree.id !== currentTreeId
      && hasMember(graph, tree.id, personId)
      && parentIds.some((parentId) => hasMember(graph, tree.id, parentId)),
  )
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) =>
    a.createdAt < b.createdAt
      ? -1
      : a.createdAt > b.createdAt
        ? 1
        : a.id < b.id
          ? -1
          : 1,
  )
  return candidates[0]
}

export function removePersonFromTreeRecords(
  graph: GlobalState,
  personId: string,
  treeId: string,
): void {
  removeMember(graph, treeId, personId)
  for (const [key, association] of Object.entries(graph.treeUnions)) {
    if (association.treeId !== treeId) continue
    const union = graph.unions[association.unionId]
    if (
      union
      && (union.firstPersonId === personId || union.secondPersonId === personId)
    ) {
      delete graph.treeUnions[key]
    }
  }
  for (const [key, association] of Object.entries(
    graph.treeParentChildRelationships,
  )) {
    if (association.treeId !== treeId) continue
    const relationship =
      graph.parentChildRelationships[association.parentChildRelationshipId]
    if (
      relationship
      && (relationship.parentPersonId === personId
        || relationship.childPersonId === personId)
    ) {
      delete graph.treeParentChildRelationships[key]
    }
  }
}

export function identityFromPerson(person: Person): PersonIdentity {
  return {
    id: person.id,
    name: person.name,
    dob: person.dob,
    dod: person.dod,
    gender: person.gender,
    birthplace: person.birthplace,
    photo: person.photo,
  }
}

export function removeFromTreeRecords(
  previous: GlobalState,
  personId: string,
  treeId: string,
): GlobalState {
  if (
    !treeIsWritable(previous, treeId)
    || !hasMember(previous, treeId, personId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  removePersonFromTreeRecords(draft, personId, treeId)
  return draft
}

export function addMemberWithSpousesRecords(
  previous: GlobalState,
  treeId: string,
  personId: string,
): GlobalState {
  if (
    !treeIsWritable(previous, treeId)
    || !previous.persons[personId]
    || hasMember(previous, treeId, personId)
  ) {
    return previous
  }
  const draft = makeDraft(previous)
  addMemberWithCurrentSpouses(draft, treeId, personId)
  return draft
}

export function deletePersonRecords(
  previous: GlobalState,
  personId: string,
): GlobalState {
  if (!previous.persons[personId]) return previous
  const draft = makeDraft(previous)
  delete draft.persons[personId]
  for (const member of Object.values(previous.treeMembers)) {
    if (member.personId === personId) {
      removePersonFromTreeRecords(draft, personId, member.treeId)
    }
  }
  return draft
}
