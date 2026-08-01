import type {
  ParentChildRelationship,
  ParentChildRelationshipType,
} from "../types"
import { associateParentChildRelationship, treeIsWritable } from "./membership"
import {
  type GlobalState,
  makeDraft,
  newId,
  now,
  treeParentChildRelationshipKey,
} from "./state"

function parentRelationshipForPair(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
  treeId?: string,
): ParentChildRelationship | undefined {
  const associatedIds = new Set(
    Object.values(graph.treeParentChildRelationships)
      .filter((association) => !treeId || association.treeId === treeId)
      .map((association) => association.parentChildRelationshipId),
  )
  return Object.values(graph.parentChildRelationships)
    .filter(
      (relationship) =>
        relationship.parentPersonId === parentPersonId
        && relationship.childPersonId === childPersonId
        && associatedIds.has(relationship.id),
    )
    .sort(
      (first, second) =>
        first.createdAt.localeCompare(second.createdAt)
        || first.id.localeCompare(second.id),
    )
    .at(-1)
}

function activeParentRelationships(
  graph: GlobalState,
): ParentChildRelationship[] {
  const associatedRelationshipIds = new Set(
    Object.values(graph.treeParentChildRelationships).map(
      (association) => association.parentChildRelationshipId,
    ),
  )
  return Object.values(graph.parentChildRelationships).filter(
    (relationship) =>
      associatedRelationshipIds.has(relationship.id)
      && !!graph.persons[relationship.parentPersonId]
      && !!graph.persons[relationship.childPersonId],
  )
}

export function canCreateParentRelationship(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
): boolean {
  if (parentPersonId === childPersonId) return false
  if (parentRelationshipForPair(graph, parentPersonId, childPersonId)) {
    return true
  }
  const relationships = activeParentRelationships(graph)
  const parentIds = new Set(
    relationships
      .filter((relationship) => relationship.childPersonId === childPersonId)
      .map((relationship) => relationship.parentPersonId),
  )
  if (parentIds.size >= 2) return false

  const descendants = new Set<string>()
  const pending = [childPersonId]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    for (const relationship of relationships) {
      if (
        relationship.parentPersonId !== current
        || descendants.has(relationship.childPersonId)
      ) {
        continue
      }
      if (relationship.childPersonId === parentPersonId) return false
      descendants.add(relationship.childPersonId)
      pending.push(relationship.childPersonId)
    }
  }
  return true
}

export function ensureParentChildRelationship(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
  type: ParentChildRelationshipType = "biological",
): ParentChildRelationship | undefined {
  const existing = parentRelationshipForPair(
    graph,
    parentPersonId,
    childPersonId,
  )
  if (existing) return existing
  if (!canCreateParentRelationship(graph, parentPersonId, childPersonId)) {
    return undefined
  }
  const timestamp = now()
  const relationship: ParentChildRelationship = {
    id: newId(),
    parentPersonId,
    childPersonId,
    type,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.parentChildRelationships[relationship.id] = relationship
  return relationship
}

export function removeParentRecords(
  previous: GlobalState,
  treeId: string,
  childPersonId: string,
  parentPersonId: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const relationship = parentRelationshipForPair(
    previous,
    parentPersonId,
    childPersonId,
    treeId,
  )
  if (!relationship) return previous
  const draft = makeDraft(previous)
  delete draft.treeParentChildRelationships[
    treeParentChildRelationshipKey(treeId, relationship.id)
  ]
  const stillAssociated = Object.values(
    draft.treeParentChildRelationships,
  ).some(
    (association) => association.parentChildRelationshipId === relationship.id,
  )
  if (!stillAssociated) {
    delete draft.parentChildRelationships[relationship.id]
  }
  return draft
}

export function setParentAdoptedRecords(
  previous: GlobalState,
  treeId: string,
  childPersonId: string,
  parentPersonId: string,
  adopted: boolean,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const relationship = parentRelationshipForPair(
    previous,
    parentPersonId,
    childPersonId,
    treeId,
  )
  if (!relationship) return previous
  return {
    ...previous,
    parentChildRelationships: {
      ...previous.parentChildRelationships,
      [relationship.id]: {
        ...relationship,
        type: adopted ? "adoptive" : "biological",
      },
    },
  }
}

/**
 * Set a parent-child relationship's type (e.g. biological/adoptive) as a
 * global fact, locating the relationship by the parent/child pair alone — not
 * scoped to any tree. Used to edit a parent that is visible here (via their
 * ancestor family) but isn't a member of this tree. Still gated on the current
 * tree being writable, since the edit originates from it.
 */
export function setParentTypeRecords(
  previous: GlobalState,
  treeId: string,
  childPersonId: string,
  parentPersonId: string,
  type: ParentChildRelationshipType,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const relationship = parentRelationshipForPair(
    previous,
    parentPersonId,
    childPersonId,
  )
  if (!relationship) return previous
  return {
    ...previous,
    parentChildRelationships: {
      ...previous.parentChildRelationships,
      [relationship.id]: { ...relationship, type },
    },
  }
}
