import { useCallback, useMemo, useSyncExternalStore } from "react"
import {
  descendantsOf,
  type FamilyData,
  type ParentChildRelationship,
  type Person,
  type PersonInput,
  projectTree,
  projectTrees,
  type Relationship,
} from "../types"
import {
  addMember,
  addMemberWithCurrentSpouses,
  associateParentChildRelationship,
  associateUnion,
  deletePersonRecords,
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
} from "./parent-child"
import { mergePersonRecords, reconcileTreeData } from "./reconcile"
import {
  ensureUnion,
  linkSpouseRecords,
  unlinkSpouseRecords,
  updateSpouseDateRecords,
} from "./unions"
import { type TreeSeed } from "./seed"
import {
  getGraph,
  getSnapshot,
  makeDraft,
  newId,
  subscribe,
  type TreeMeta,
  update,
} from "./state"

export function useTreeIndex() {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)

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

  const deleteTree = useCallback(deleteTreeById, [])

  return { trees: graph.index, createTree, renameTree, deleteTree }
}

export async function deleteTreeById(id: string): Promise<void> {
  const response = await fetch(`/api/trees/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!response.ok) throw new Error(`delete failed: ${response.status}`)

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

export function countMembers(treeId: string): number {
  return Object.values(getSnapshot().treeMembers).filter(
    (member) => member.treeId === treeId,
  ).length
}

export function useMemberTrees(personId: string): TreeMeta[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(
    () => graph.index.filter((tree) => hasMember(graph, tree.id, personId)),
    [graph, personId],
  )
}

export function useMembersOf(
  treeId: string | undefined,
): { id: string; name: string }[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    if (!treeId) return []
    return Object.values(graph.treeMembers)
      .filter((member) => member.treeId === treeId)
      .sort(
        (first, second) =>
          first.createdAt.localeCompare(second.createdAt)
          || first.personId.localeCompare(second.personId),
      )
      .map((member) => ({
        id: member.personId,
        name: graph.persons[member.personId]?.name ?? "?",
      }))
  }, [graph, treeId])
}

export function useTreePeople(treeId: string | undefined): Person[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(
    () =>
      treeId ? Object.values(projectTree(graph.persons, graph, treeId)) : [],
    [graph, treeId],
  )
}

export type PersonSearchResult = {
  personId: string
  name: string
  /** Earliest tree the person belongs to. */
  treeId: string
}

/** Every person in the store, each paired with the earliest tree they're in. */
export function usePersonSearch(): PersonSearchResult[] {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    const treeExists = new Set(graph.index.map((tree) => tree.id))
    const earliest = new Map<
      string,
      { personId: string; treeId: string; createdAt: string }
    >()
    for (const member of Object.values(graph.treeMembers)) {
      if (!treeExists.has(member.treeId)) continue
      if (!graph.persons[member.personId]) continue
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
      name: graph.persons[result.personId]?.name ?? "",
      treeId: result.treeId,
    }))
  }, [graph])
}

export function useFamilyAll(treeId: string, enabled: boolean): FamilyData {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    if (!enabled) return projectTree(graph.persons, graph, treeId)
    const treeIds = [
      treeId,
      ...graph.index
        .filter((tree) => tree.id !== treeId)
        .map((tree) => tree.id),
    ]
    return projectTrees(graph.persons, graph, treeIds)
  }, [graph, treeId, enabled])
}

export function useFamily(treeId: string) {
  const graph = useSyncExternalStore(subscribe, getGraph, getGraph)
  const people = useMemo(
    () => projectTree(graph.persons, graph, treeId),
    [graph, treeId],
  )
  const readOnly = useMemo(
    () => graph.index.find((tree) => tree.id === treeId)?.role === "viewer",
    [graph, treeId],
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
        const currentFamily = projectTree(previous.persons, previous, treeId)
        const parentIds = [
          parentPersonId,
          ...(currentFamily[parentPersonId]?.spouseIds ?? []),
        ]
        const draft = makeDraft(previous)
        addMember(draft, treeId, childPersonId)
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
    addParent,
    removeParent,
    setParentAdopted,
    linkAcrossTrees,
    linkParentAcrossTrees,
    linkChildAcrossTrees,
    removeFromTree,
    replaceAll,
  }
}

export type FamilyStore = ReturnType<typeof useFamily>
