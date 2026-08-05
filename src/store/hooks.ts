import { useCallback, useEffect, useMemo, useRef } from "react"
import type { RequestableAncestorLink } from "../sync/types"
import {
  descendantsOf,
  type FamilyData,
  type NormalizedRelationships,
  type ParentChildRelationship,
  type ParentChildRelationshipType,
  type ParentLink,
  type Person,
  type PersonIdentity,
  type PersonInput,
  projectTree,
  projectTreeStable,
  projectTreesStable,
  type Relationship,
  relationshipsSame,
} from "../types"
import {
  addMember,
  addMemberWithCurrentSpouses,
  associateParentChildRelationship,
  associateUnion,
  deletePersonRecords,
  findAncestorTree,
  hasMember,
  removeFromTreeRecords,
  treeIsWritable,
  treesContainingAll,
  treesWithMember,
} from "./membership"
import {
  ensureParentChildRelationship,
  removeParentRecords,
  setParentAdoptedRecords,
  setParentTypeRecords,
} from "./parent-child"
import { mergePersonRecords, reconcileTreeData } from "./reconcile"
import type { TreeSeed } from "./seed"
import {
  applyTreeSnapshot,
  deleteTreeOnServer,
  fetchTreeSnapshot,
  getSnapshot,
  makeDraft,
  newId,
  type TreeMeta,
  update,
  useAncestorTreeLinks,
  useParentChildRelationships,
  usePersons,
  useRequestableAncestorLinks,
  useTreeMembers,
  useTreeParentChildRelationships,
  useTrees,
  useTreeUnions,
  useUnionEvents,
  useUnions,
} from "./state"
import {
  ensureUnion,
  linkSpouseRecords,
  markDivorcedRecords,
  unlinkSpouseRecords,
  updateSpouseDateRecords,
} from "./unions"

export function useTreeIndex() {
  const trees = useTrees()

  const createTree = useCallback((name: string, seed?: TreeSeed): string => {
    const id = newId()
    update((previous) => {
      const draft = makeDraft(previous)
      draft.index = [
        ...previous.index,
        { id, name, createdAt: new Date().toISOString() },
      ]
      if (seed) reconcileTreeData(draft, id, seed.people)
      return draft
    })
    return id
  }, [])

  const renameTree = useCallback((id: string, name: string) => {
    update((previous) => ({
      ...previous,
      index: previous.index.map((tree) =>
        tree.id === id ? { ...tree, name } : tree,
      ),
    }))
  }, [])

  const deleteTreeRemote = useCallback(async (id: string) => {
    await deleteTreeOnServer(id)
  }, [])
  const removeTree = useCallback(removeTreeFromIndex, [])

  return { trees, createTree, renameTree, deleteTreeRemote, removeTree }
}

export async function deleteTreeById(id: string): Promise<void> {
  await deleteTreeOnServer(id)
  removeTreeFromIndex(id)
}

/**
 * Remove a tree and all of its members/unions/parent-child relationships from
 * the local store. Split from `deleteTreeById` so callers can await the server
 * deletion, react to success, then drop the tree from the store.
 */
export function removeTreeFromIndex(id: string): void {
  update(
    (previous) => {
      const draft = makeDraft(previous)
      draft.index = previous.index.filter((tree) => tree.id !== id)
      for (const [key, member] of Object.entries(draft.treeMembers)) {
        if (member.treeId === id) delete draft.treeMembers[key]
      }
      for (const [key, association] of Object.entries(draft.treeUnions)) {
        if (association.treeId === id) delete draft.treeUnions[key]
      }
      for (const [key, association] of Object.entries(
        draft.treeParentChildRelationships,
      )) {
        if (association.treeId === id) {
          delete draft.treeParentChildRelationships[key]
        }
      }
      return draft
    },
    { remote: true },
  )
}

export type TreeIndexStore = ReturnType<typeof useTreeIndex>

/**
 * Create a brand-new tree and seed it with a single root member in one atomic
 * update. Returns the new tree id and the new person id so the caller can link
 * relatives (e.g. via `linkParentAcrossTrees`). Mirrors `useTreeIndex.createTree`
 * + a "root" `addPerson`, but works for a tree id that only exists mid-update.
 */
export function createTreeWithRootMember(
  name: string,
  input: PersonInput,
): { treeId: string; personId: string } {
  const treeId = newId()
  const personId = newId()
  update((previous) => {
    const draft = makeDraft(previous)
    draft.index = [
      ...previous.index,
      { id: treeId, name, createdAt: new Date().toISOString() },
    ]
    draft.persons[personId] = { id: personId, ...input }
    addMember(draft, treeId, personId)
    return draft
  })
  return { treeId, personId }
}

export function countMembers(treeId: string): number {
  const snapshot = getSnapshot()
  const tree = snapshot.index.find((candidate) => candidate.id === treeId)
  if (!tree?.loaded && tree?.memberCount !== undefined) return tree.memberCount
  return Object.values(snapshot.treeMembers).filter(
    (member) => member.treeId === treeId,
  ).length
}

export function useMemberTrees(personId: string): TreeMeta[] {
  const treeMembers = useTreeMembers()
  const index = useTrees()
  return useMemo(
    () => index.filter((tree) => hasMember(treeMembers, tree.id, personId)),
    [index, treeMembers, personId],
  )
}

/**
 * The person's "ancestor family": another tree (not the current one) that holds
 * both the person and at least one of their parents. Prefers the display-only
 * link resolved by the server snapshot (available before every related tree is
 * loaded), falling back to {@link findAncestorTree} once the membership graph is
 * fully present.
 */
export function useAncestorTree(
  personId: string,
  currentTreeId: string,
): TreeMeta | undefined {
  const index = useTrees()
  const treeMembers = useTreeMembers()
  const parentChildRelationships = useParentChildRelationships()
  const links = useAncestorTreeLinks(currentTreeId)
  return useMemo(() => {
    const linkedTreeId = links.get(personId)
    if (linkedTreeId && linkedTreeId !== currentTreeId) {
      const linked = index.find((tree) => tree.id === linkedTreeId)
      if (linked) return linked
    }
    return findAncestorTree(
      { index, treeMembers, parentChildRelationships },
      personId,
      currentTreeId,
    )
  }, [
    index,
    treeMembers,
    parentChildRelationships,
    links,
    personId,
    currentTreeId,
  ])
}

/**
 * An inaccessible ancestor family for a person — another tree (not the current
 * one) that holds both them and a parent, but which the viewer lacks a role on
 * — surfaced so the card can offer a "request access" badge. Returned only
 * when there is no accessible ancestor, so a card shows at most one top badge
 * (open it, or request access). Carries the tree name because the client has no
 * index entry for trees it can't access.
 */
export function useRequestableAncestor(
  personId: string,
  currentTreeId: string,
): RequestableAncestorLink | undefined {
  const ancestorTree = useAncestorTree(personId, currentTreeId)
  const links = useRequestableAncestorLinks(currentTreeId)
  return useMemo(() => {
    if (ancestorTree) return undefined
    return links.get(personId)
  }, [ancestorTree, links, personId])
}

const NO_PARENT_LINKS: { link: ParentLink; person: Person }[] = []
const NO_FAMILY: FamilyData = {}

function useRelationships(): NormalizedRelationships {
  return {
    treeMembers: useTreeMembers(),
    unions: useUnions(),
    unionEvents: useUnionEvents(),
    treeUnions: useTreeUnions(),
    parentChildRelationships: useParentChildRelationships(),
    treeParentChildRelationships: useTreeParentChildRelationships(),
  }
}

/**
 * A person's parents that live in their "ancestor family" — another tree that
 * contains both them and at least one parent — so they can be shown (and, in
 * edit mode, edited) even when the current tree has none. Each entry pairs the
 * parent-child link (carrying the relationship type, e.g. adoptive) with the
 * resolved parent. The ancestor tree is loaded on demand (mirroring
 * {@link useMembersOf}); until it resolves, `parents` is empty. Returns
 * `ancestorTree` so callers can link into it.
 */
export function useAncestorParents(
  personId: string,
  currentTreeId: string,
): {
  ancestorTree: TreeMeta | undefined
  parents: { link: ParentLink; person: Person }[]
} {
  const trees = useTrees()
  const persons = usePersons()
  const relationships = useRelationships()
  const ancestorTree = useAncestorTree(personId, currentTreeId)
  const ancestorTreeId = ancestorTree?.id
  const loaded = ancestorTreeId
    ? trees.find((tree) => tree.id === ancestorTreeId)?.loaded
    : true
  useEffect(() => {
    if (!ancestorTreeId || loaded) return
    let cancelled = false
    void fetchTreeSnapshot(ancestorTreeId)
      .then((snapshot) => {
        if (!cancelled) applyTreeSnapshot(snapshot)
      })
      .catch((error: unknown) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [ancestorTreeId, loaded])

  const people = useStableFamily(persons, relationships, ancestorTreeId)
  const parents = useMemo(() => {
    if (!ancestorTreeId) return NO_PARENT_LINKS
    const projected = people[personId]
    if (!projected) return NO_PARENT_LINKS
    return projected.parents
      .map((link) => {
        const parent = people[link.id]
        return parent ? { link, person: parent } : undefined
      })
      .filter((entry): entry is { link: ParentLink; person: Person } => !!entry)
  }, [people, personId, ancestorTreeId])

  return { ancestorTree, parents }
}

/** A person's global identity, even when they aren't a member of any tree you
 *  are viewing (e.g. an ancestor parent shown from another tree). */
export function usePersonIdentity(
  personId: string | undefined,
): PersonIdentity | undefined {
  const persons = usePersons()
  return personId ? persons[personId] : undefined
}

export function useMembersOf(
  treeId: string | undefined,
): { id: string; name: string }[] {
  const trees = useTrees()
  const treeMembers = useTreeMembers()
  const persons = usePersons()
  const loaded = treeId
    ? trees.find((tree) => tree.id === treeId)?.loaded
    : true
  useEffect(() => {
    if (!treeId || loaded) return
    let cancelled = false
    void fetchTreeSnapshot(treeId)
      .then((snapshot) => {
        if (!cancelled) applyTreeSnapshot(snapshot)
      })
      .catch((error: unknown) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [loaded, treeId])
  return useMemo(() => {
    if (!treeId) return []
    return Object.values(treeMembers)
      .filter((member) => member.treeId === treeId)
      .sort(
        (first, second) =>
          first.createdAt.localeCompare(second.createdAt)
          || first.personId.localeCompare(second.personId),
      )
      .map((member) => ({
        id: member.personId,
        name: persons[member.personId]?.name ?? "?",
      }))
  }, [persons, treeId, treeMembers])
}

const NO_PEOPLE: Person[] = []

/**
 * Project one tree with structural sharing: returns a referentially stable
 * `FamilyData` (reusing the previous result) whenever this tree's identities
 * and relationships are unchanged, so downstream `useMemo` and `React.memo`
 * boundaries don't recompute on unrelated edits. Returns `NO_FAMILY` (without
 * touching the cache) when `treeId` is absent.
 */
function useStableFamily(
  identities: Record<string, PersonIdentity>,
  relationships: NormalizedRelationships,
  treeId: string | undefined,
): FamilyData {
  const projectionRef = useRef<
    | {
        treeId: string
        identities: Record<string, PersonIdentity>
        relationships: NormalizedRelationships
        family: FamilyData
      }
    | undefined
  >(undefined)
  return useMemo(() => {
    if (!treeId) return NO_FAMILY
    const previous = projectionRef.current
    const sameTree = previous?.treeId === treeId
    const family = projectTreeStable(
      sameTree ? previous?.family : undefined,
      sameTree ? previous?.identities : undefined,
      sameTree ? previous?.relationships : undefined,
      identities,
      relationships,
      treeId,
    )
    projectionRef.current = {
      treeId,
      identities,
      relationships,
      family,
    }
    return family
  }, [identities, relationships, treeId])
}

export function useTreePeople(treeId: string | undefined): Person[] {
  const persons = usePersons()
  const relationships = useRelationships()
  // Reuse `useStableFamily`'s referentially stable FamilyData, then derive the
  // Person[] only when that projection actually changed.
  const family = useStableFamily(persons, relationships, treeId)
  const peopleRef = useRef<
    { family: FamilyData; people: Person[] } | undefined
  >(undefined)
  return useMemo(() => {
    if (!treeId) return NO_PEOPLE
    const people =
      peopleRef.current?.family === family
        ? peopleRef.current.people
        : Object.values(family)
    peopleRef.current = { family, people }
    return people
  }, [family, treeId])
}

export type PersonSearchResult = {
  personId: string
  name: string
  /** Earliest tree the person belongs to. */
  treeId: string
}

/** Every person in the store, each paired with the earliest tree they're in. */
export function usePersonSearch(): PersonSearchResult[] {
  const trees = useTrees()
  const treeMembers = useTreeMembers()
  const persons = usePersons()
  return useMemo(() => {
    const treeExists = new Set(trees.map((tree) => tree.id))
    const earliest = new Map<
      string,
      { personId: string; treeId: string; createdAt: string }
    >()
    for (const member of Object.values(treeMembers)) {
      if (!treeExists.has(member.treeId)) continue
      if (!persons[member.personId]) continue
      const current = earliest.get(member.personId)
      if (!current || member.createdAt.localeCompare(current.createdAt) < 0) {
        earliest.set(member.personId, {
          personId: member.personId,
          treeId: member.treeId,
          createdAt: member.createdAt,
        })
      }
    }
    return [...earliest.values()].map((result) => ({
      personId: result.personId,
      name: persons[result.personId]?.name ?? "",
      treeId: result.treeId,
    }))
  }, [persons, treeMembers, trees])
}

export function useFamilyAll(treeId: string, enabled: boolean): FamilyData {
  const persons = usePersons()
  const trees = useTrees()
  const relationships = useRelationships()
  // Structural-sharing projection (mirrors useFamily): short-circuit before
  // recomputing the related-tree set when this view's inputs are unchanged, so
  // "show all families" does no per-keystroke work while editing unrelated
  // state. projectTreesStable then reuses unchanged Person objects on change.
  const projectionRef = useRef<
    | {
        treeId: string
        identities: Record<string, PersonIdentity>
        relationships: NormalizedRelationships
        index: TreeMeta[]
        family: FamilyData
      }
    | undefined
  >(undefined)
  return useMemo(() => {
    // When "show all families" is off, the caller reuses `useFamily`'s tree
    // projection as `renderPeople`, so this hook skips projecting a second time.
    if (!enabled) return NO_FAMILY
    const prev = projectionRef.current
    const sameTree = prev?.treeId === treeId
    if (
      sameTree
      && prev
      && prev.identities === persons
      && prev.index === trees
      && relationshipsSame(prev.relationships, relationships)
    ) {
      return prev.family
    }
    // Only render trees that share at least one member with the current tree:
    // those are the families connected/related to this one. Trees with no
    // overlapping members stay off the canvas.
    const currentMembers = new Set(
      Object.values(relationships.treeMembers)
        .filter((member) => member.treeId === treeId)
        .map((member) => member.personId),
    )
    const relatedTreeIds = trees
      .filter(
        (tree) =>
          tree.id === treeId
          || Object.values(relationships.treeMembers).some(
            (member) =>
              member.treeId === tree.id && currentMembers.has(member.personId),
          ),
      )
      .map((tree) => tree.id)
    const family = projectTreesStable(
      sameTree ? prev?.family : undefined,
      sameTree ? prev?.identities : undefined,
      sameTree ? prev?.relationships : undefined,
      persons,
      relationships,
      relatedTreeIds,
    )
    projectionRef.current = {
      treeId,
      identities: persons,
      relationships,
      index: trees,
      family,
    }
    return family
  }, [enabled, persons, relationships, treeId, trees])
}

export function useFamily(treeId: string) {
  const persons = usePersons()
  const trees = useTrees()
  const relationships = useRelationships()
  const people = useStableFamily(persons, relationships, treeId)
  const readOnly = useMemo(
    () => trees.find((tree) => tree.id === treeId)?.role === "viewer",
    [treeId, trees],
  )

  const addPerson = useCallback(
    (input: PersonInput, relationship: Relationship): string => {
      const id = newId()
      update((previous) => {
        if (!treeIsWritable(previous, treeId)) return previous
        const draft = makeDraft(previous)
        draft.persons[id] = { id, ...input }
        addMember(draft, treeId, id)

        if (relationship.kind === "spouse") {
          const union = ensureUnion(draft, id, relationship.partnerId)
          associateUnion(draft, treeId, union.id)
          for (const targetTreeId of treesWithMember(
            previous,
            relationship.partnerId,
            treeId,
          )) {
            addMember(draft, targetTreeId, id)
            associateUnion(draft, targetTreeId, union.id)
          }
        } else if (relationship.kind === "child") {
          const parentIds = [
            relationship.parentId,
            relationship.otherParentId,
          ].filter((candidate): candidate is string => !!candidate)
          const relationships: ParentChildRelationship[] = []
          for (const parentId of parentIds) {
            const parentRelationship = ensureParentChildRelationship(
              draft,
              parentId,
              id,
              relationship.adopted ? "adoptive" : "biological",
            )
            if (!parentRelationship) return previous
            relationships.push(parentRelationship)
          }
          for (const parentRelationship of relationships) {
            associateParentChildRelationship(
              draft,
              treeId,
              parentRelationship.id,
            )
          }
          for (const targetTreeId of treesContainingAll(
            previous,
            parentIds,
            treeId,
          )) {
            addMember(draft, targetTreeId, id)
            for (const parentRelationship of relationships) {
              associateParentChildRelationship(
                draft,
                targetTreeId,
                parentRelationship.id,
              )
            }
          }
        } else if (relationship.kind === "parent") {
          const parentRelationship = ensureParentChildRelationship(
            draft,
            id,
            relationship.childId,
          )
          if (!parentRelationship) return previous
          associateParentChildRelationship(draft, treeId, parentRelationship.id)
          if (relationship.marryExisting) {
            const child = projectTree(draft.persons, draft, treeId)[
              relationship.childId
            ]
            const existingParentId = child?.parents.find(
              (parent) => parent.id !== id,
            )?.id
            if (existingParentId) {
              const union = ensureUnion(draft, id, existingParentId)
              associateUnion(draft, treeId, union.id)
              for (const targetTreeId of treesWithMember(
                previous,
                existingParentId,
                treeId,
              )) {
                addMember(draft, targetTreeId, id)
                associateUnion(draft, targetTreeId, union.id)
              }
            }
          }
        }
        return draft
      })
      return id
    },
    [treeId],
  )

  const updatePerson = useCallback((id: string, input: PersonInput) => {
    update((previous) => {
      const person = previous.persons[id]
      if (!person) return previous
      return {
        ...previous,
        persons: { ...previous.persons, [id]: { ...person, ...input } },
      }
    })
  }, [])

  const deletePerson = useCallback((id: string) => {
    update((previous) => deletePersonRecords(previous, id))
  }, [])

  const mergePersons = useCallback((keepId: string, dropId: string) => {
    update((previous) => mergePersonRecords(previous, keepId, dropId))
  }, [])

  const linkSpouse = useCallback(
    (firstPersonId: string, secondPersonId: string) => {
      update((previous) => {
        const targetTreeIds = [
          treeId,
          ...treesContainingAll(
            previous,
            [firstPersonId, secondPersonId],
            treeId,
          ),
        ]
        return linkSpouseRecords(
          previous,
          targetTreeIds,
          firstPersonId,
          secondPersonId,
        )
      })
    },
    [treeId],
  )

  const unlinkSpouse = useCallback(
    (firstPersonId: string, secondPersonId: string) => {
      update((previous) =>
        unlinkSpouseRecords(previous, treeId, firstPersonId, secondPersonId),
      )
    },
    [treeId],
  )

  const updateSpouseDate = useCallback(
    (firstPersonId: string, secondPersonId: string, date: string) => {
      update((previous) =>
        updateSpouseDateRecords(
          previous,
          treeId,
          firstPersonId,
          secondPersonId,
          date,
        ),
      )
    },
    [treeId],
  )

  const setDivorced = useCallback(
    (
      firstPersonId: string,
      secondPersonId: string,
      divorced: boolean,
      date?: string,
    ) => {
      update((previous) =>
        markDivorcedRecords(
          previous,
          treeId,
          firstPersonId,
          secondPersonId,
          divorced,
          date,
        ),
      )
    },
    [treeId],
  )

  const addParent = useCallback(
    (childPersonId: string, parentPersonId: string) => {
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !previous.persons[childPersonId]
          || !previous.persons[parentPersonId]
          || childPersonId === parentPersonId
        ) {
          return previous
        }
        const family = projectTree(previous.persons, previous, treeId)
        if (descendantsOf(family, childPersonId).has(parentPersonId)) {
          return previous
        }
        const draft = makeDraft(previous)
        const relationship = ensureParentChildRelationship(
          draft,
          parentPersonId,
          childPersonId,
        )
        if (!relationship) return previous
        associateParentChildRelationship(draft, treeId, relationship.id)

        const projected = projectTree(draft.persons, draft, treeId)
        const parentIds =
          projected[childPersonId]?.parents.map((parent) => parent.id) ?? []
        for (const targetTreeId of treesContainingAll(
          previous,
          parentIds,
          treeId,
        )) {
          addMember(draft, targetTreeId, childPersonId)
          for (const candidateParentId of parentIds) {
            const candidateRelationship = ensureParentChildRelationship(
              draft,
              candidateParentId,
              childPersonId,
            )
            if (!candidateRelationship) continue
            associateParentChildRelationship(
              draft,
              targetTreeId,
              candidateRelationship.id,
            )
          }
        }
        return draft
      })
    },
    [treeId],
  )

  const removeParent = useCallback(
    (childPersonId: string, parentPersonId: string) => {
      update((previous) =>
        removeParentRecords(previous, treeId, childPersonId, parentPersonId),
      )
    },
    [treeId],
  )

  const setParentAdopted = useCallback(
    (childPersonId: string, parentPersonId: string, adopted: boolean) => {
      update((previous) =>
        setParentAdoptedRecords(
          previous,
          treeId,
          childPersonId,
          parentPersonId,
          adopted,
        ),
      )
    },
    [treeId],
  )

  /**
   * Set a parent-child relationship's type as a global fact, locating the
   * relationship by the parent/child pair alone (not scoped to this tree). Lets
   * a parent that is only visible here via their ancestor family be edited
   * (e.g. toggling adopted) without joining this tree.
   */
  const setParentType = useCallback(
    (
      childPersonId: string,
      parentPersonId: string,
      type: ParentChildRelationshipType,
    ) => {
      update((previous) =>
        setParentTypeRecords(
          previous,
          treeId,
          childPersonId,
          parentPersonId,
          type,
        ),
      )
    },
    [treeId],
  )

  const linkAcrossTrees = useCallback(
    (personId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !treeIsWritable(previous, otherTreeId)
          || !previous.persons[personId]
          || !previous.persons[otherPersonId]
        ) {
          return previous
        }
        const draft = makeDraft(previous)
        const union = ensureUnion(draft, personId, otherPersonId)
        addMember(draft, treeId, otherPersonId)
        addMember(draft, otherTreeId, personId)
        associateUnion(draft, treeId, union.id)
        associateUnion(draft, otherTreeId, union.id)
        for (const targetTreeId of treesContainingAll(previous, [
          personId,
          otherPersonId,
        ])) {
          associateUnion(draft, targetTreeId, union.id)
        }
        return draft
      })
    },
    [treeId],
  )

  const linkParentAcrossTrees = useCallback(
    (childPersonId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !treeIsWritable(previous, otherTreeId)
          || !previous.persons[childPersonId]
          || !previous.persons[otherPersonId]
        ) {
          return previous
        }
        const otherFamily = projectTree(previous.persons, previous, otherTreeId)
        if (descendantsOf(otherFamily, childPersonId).has(otherPersonId)) {
          return previous
        }

        const currentFamily = projectTree(previous.persons, previous, treeId)
        const included = new Set<string>([childPersonId])
        for (const descendant of descendantsOf(currentFamily, childPersonId)) {
          included.add(descendant)
        }
        for (const personId of [...included]) {
          for (const spouseId of currentFamily[personId]?.spouseIds ?? []) {
            if (currentFamily[spouseId]) included.add(spouseId)
          }
        }

        const draft = makeDraft(previous)
        for (const personId of included) {
          addMemberWithCurrentSpouses(draft, otherTreeId, personId)
        }
        for (const personId of included) {
          const person = currentFamily[personId]
          if (!person) continue
          for (const parent of person.parents) {
            if (!included.has(parent.id)) continue
            const relationship = ensureParentChildRelationship(
              draft,
              parent.id,
              personId,
              parent.type ?? (parent.adopted ? "adoptive" : "biological"),
            )
            if (!relationship) return previous
            associateParentChildRelationship(
              draft,
              otherTreeId,
              relationship.id,
            )
          }
          for (const spouseId of person.spouseIds) {
            if (!included.has(spouseId)) continue
            const union = ensureUnion(draft, personId, spouseId)
            associateUnion(draft, otherTreeId, union.id)
          }
        }

        const selectedParentRelationship = ensureParentChildRelationship(
          draft,
          otherPersonId,
          childPersonId,
        )
        if (!selectedParentRelationship) return previous
        associateParentChildRelationship(
          draft,
          otherTreeId,
          selectedParentRelationship.id,
        )
        for (const spouseId of otherFamily[otherPersonId]?.spouseIds ?? []) {
          const spouseRelationship = ensureParentChildRelationship(
            draft,
            spouseId,
            childPersonId,
          )
          if (!spouseRelationship) return previous
          associateParentChildRelationship(
            draft,
            otherTreeId,
            spouseRelationship.id,
          )
        }
        return draft
      })
    },
    [treeId],
  )

  const linkChildAcrossTrees = useCallback(
    (parentPersonId: string, otherTreeId: string, childPersonId: string) => {
      if (otherTreeId === treeId) return
      update((previous) => {
        if (
          !treeIsWritable(previous, treeId)
          || !previous.persons[parentPersonId]
          || !previous.persons[childPersonId]
        ) {
          return previous
        }
        const otherFamily = projectTree(previous.persons, previous, otherTreeId)
        if (descendantsOf(otherFamily, childPersonId).has(parentPersonId)) {
          return previous
        }

        // Bring the child's whole subtree over from the other tree: the
        // child, their descendants, and the spouses of everyone in that set.
        const included = new Set<string>([childPersonId])
        for (const descendant of descendantsOf(otherFamily, childPersonId)) {
          included.add(descendant)
        }
        for (const personId of [...included]) {
          for (const spouseId of otherFamily[personId]?.spouseIds ?? []) {
            if (otherFamily[spouseId]) included.add(spouseId)
          }
        }

        const draft = makeDraft(previous)
        for (const personId of included) {
          addMemberWithCurrentSpouses(draft, treeId, personId)
        }
        for (const personId of included) {
          const person = otherFamily[personId]
          if (!person) continue
          for (const parent of person.parents) {
            if (!included.has(parent.id)) continue
            const relationship = ensureParentChildRelationship(
              draft,
              parent.id,
              personId,
              parent.type ?? (parent.adopted ? "adoptive" : "biological"),
            )
            if (!relationship) return previous
            associateParentChildRelationship(draft, treeId, relationship.id)
          }
          for (const spouseId of person.spouseIds) {
            if (!included.has(spouseId)) continue
            const union = ensureUnion(draft, personId, spouseId)
            associateUnion(draft, treeId, union.id)
          }
        }

        // Link the selected parent (and their current co-parent) to the child.
        const currentFamily = projectTree(previous.persons, previous, treeId)
        const parentIds = [
          parentPersonId,
          ...(currentFamily[parentPersonId]?.spouseIds ?? []),
        ]
        for (const candidateParentId of parentIds) {
          if (!previous.persons[candidateParentId]) continue
          const relationship = ensureParentChildRelationship(
            draft,
            candidateParentId,
            childPersonId,
          )
          if (!relationship) continue
          associateParentChildRelationship(draft, treeId, relationship.id)
        }
        return draft
      })
    },
    [treeId],
  )

  const removeFromTree = useCallback(
    (personId: string, targetTreeId: string) => {
      update((previous) =>
        removeFromTreeRecords(previous, personId, targetTreeId),
      )
    },
    [],
  )

  const replaceAll = useCallback(
    (data: FamilyData) => {
      update((previous) => {
        if (!treeIsWritable(previous, treeId)) return previous
        const draft = makeDraft(previous)
        reconcileTreeData(draft, treeId, data)
        return draft
      })
    },
    [treeId],
  )

  return {
    people,
    readOnly,
    addPerson,
    updatePerson,
    deletePerson,
    mergePersons,
    linkSpouse,
    unlinkSpouse,
    updateSpouseDate,
    setDivorced,
    addParent,
    removeParent,
    setParentAdopted,
    setParentType,
    linkAcrossTrees,
    linkParentAcrossTrees,
    linkChildAcrossTrees,
    removeFromTree,
    replaceAll,
  }
}

export type FamilyStore = ReturnType<typeof useFamily>
