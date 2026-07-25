import {
  type ParentChildRelationship,
  type ParentChildRelationshipType,
} from "../types"
import {
  type GlobalState,
  makeDraft,
  newId,
  now,
  treeParentChildRelationshipKey,
} from "./state"
import { associateParentChildRelationship, treeIsWritable } from "./membership"

function parentRelationshipForPair(
  graph: GlobalState,
  parentPersonId: string,
  childPersonId: string,
  treeId?: string,
): ParentChildRelationship | undefined {
  const associatedIds = treeId
    ? new Set(
        Object.values(graph.treeParentChildRelationships)
          .filter((association) => association.treeId === treeId)
          .map((association) => association.parentChildRelationshipId),
      )
    : undefined
  return Object.values(graph.parentChildRelationships)
    .filter(
      (relationship) =>
        relationship.parentPersonId === parentPersonId
        && relationship.childPersonId === childPersonId
        && (!associatedIds || associatedIds.has(relationship.id)),
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
  return Object.values(graph.parentChildRelationships).filter(
    (relationship) =>
      !!graph.persons[relationship.parentPersonId]
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
