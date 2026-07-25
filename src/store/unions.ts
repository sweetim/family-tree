import {
  canonicalPersonPair,
  type Union,
  type UnionEvent,
  unionIsCurrent,
} from "../types"
import {
  type GlobalState,
  makeDraft,
  newId,
  now,
  treeUnionKey,
} from "./state"
import { associateUnion, hasMember, treeIsWritable } from "./membership"

function unionEventsFor(graph: GlobalState, unionId: string): UnionEvent[] {
  return Object.values(graph.unionEvents).filter(
    (event) => event.unionId === unionId,
  )
}

function currentUnionForPair(
  graph: GlobalState,
  firstPersonId: string,
  secondPersonId: string,
  treeId?: string,
): Union | undefined {
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const associatedIds = treeId
    ? new Set(
        Object.values(graph.treeUnions)
          .filter((association) => association.treeId === treeId)
          .map((association) => association.unionId),
      )
    : undefined
  return Object.values(graph.unions)
    .filter(
      (union) =>
        union.firstPersonId === first
        && union.secondPersonId === second
        && (!associatedIds || associatedIds.has(union.id))
        && unionIsCurrent(union.id, graph.unionEvents),
    )
    .sort(
      (firstUnion, secondUnion) =>
        firstUnion.createdAt.localeCompare(secondUnion.createdAt)
        || firstUnion.id.localeCompare(secondUnion.id),
    )
    .at(-1)
}

export function ensureMarriedEvent(
  graph: GlobalState,
  unionId: string,
): UnionEvent {
  const existing = unionEventsFor(graph, unionId)
    .filter((event) => event.type === "married")
    .sort(
      (first, second) =>
        first.createdAt.localeCompare(second.createdAt)
        || first.id.localeCompare(second.id),
    )
    .at(-1)
  if (existing) return existing
  const timestamp = now()
  const event: UnionEvent = {
    id: newId(),
    unionId,
    type: "married",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unionEvents[event.id] = event
  return event
}

export function ensureUnion(
  graph: GlobalState,
  firstPersonId: string,
  secondPersonId: string,
): Union {
  const existing = currentUnionForPair(graph, firstPersonId, secondPersonId)
  if (existing) {
    ensureMarriedEvent(graph, existing.id)
    return existing
  }
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const timestamp = now()
  const union: Union = {
    id: newId(),
    firstPersonId: first,
    secondPersonId: second,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unions[union.id] = union
  ensureMarriedEvent(graph, union.id)
  return union
}

function compareCreatedRecords(
  first: { id: string; createdAt: string },
  second: { id: string; createdAt: string },
): number {
  return (
    first.createdAt.localeCompare(second.createdAt)
    || first.id.localeCompare(second.id)
  )
}

/** Clone a union's marriage event onto a fresh union for a new person pair. */
export function createReplacementUnion(
  graph: GlobalState,
  source: Union,
  firstPersonId: string,
  secondPersonId: string,
): Union {
  const existing = currentUnionForPair(graph, firstPersonId, secondPersonId)
  if (existing) return existing
  const [first, second] = canonicalPersonPair(firstPersonId, secondPersonId)
  const timestamp = now()
  const replacement: Union = {
    id: newId(),
    firstPersonId: first,
    secondPersonId: second,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  graph.unions[replacement.id] = replacement
  const marriageEvent = unionEventsFor(graph, source.id)
    .filter((event) => event.type === "married")
    .sort(compareCreatedRecords)
    .at(-1)
  if (!marriageEvent) {
    ensureMarriedEvent(graph, replacement.id)
  } else {
    const eventId = newId()
    graph.unionEvents[eventId] = {
      ...marriageEvent,
      id: eventId,
      unionId: replacement.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  return replacement
}

export function linkSpouseRecords(
  previous: GlobalState,
  treeIds: Iterable<string>,
  firstPersonId: string,
  secondPersonId: string,
): GlobalState {
  if (
    firstPersonId === secondPersonId
    || !previous.persons[firstPersonId]
    || !previous.persons[secondPersonId]
  ) {
    return previous
  }
  const eligibleTreeIds = [...treeIds].filter(
    (treeId) =>
      treeIsWritable(previous, treeId)
      && hasMember(previous, treeId, firstPersonId)
      && hasMember(previous, treeId, secondPersonId),
  )
  if (eligibleTreeIds.length === 0) return previous
  const draft = makeDraft(previous)
  const union = ensureUnion(draft, firstPersonId, secondPersonId)
  for (const treeId of eligibleTreeIds) associateUnion(draft, treeId, union.id)
  return draft
}

export function unlinkSpouseRecords(
  previous: GlobalState,
  treeId: string,
  firstPersonId: string,
  secondPersonId: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const union = currentUnionForPair(
    previous,
    firstPersonId,
    secondPersonId,
    treeId,
  )
  if (!union) return previous
  const draft = makeDraft(previous)
  delete draft.treeUnions[treeUnionKey(treeId, union.id)]
  return draft
}

export function updateSpouseDateRecords(
  previous: GlobalState,
  treeId: string,
  firstPersonId: string,
  secondPersonId: string,
  date: string,
): GlobalState {
  if (!treeIsWritable(previous, treeId)) return previous
  const union = currentUnionForPair(
    previous,
    firstPersonId,
    secondPersonId,
    treeId,
  )
  if (!union) return previous
  const draft = makeDraft(previous)
  const event = ensureMarriedEvent(draft, union.id)
  draft.unionEvents[event.id] = {
    ...event,
    eventDate: date || undefined,
  }
  return draft
}
