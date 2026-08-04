import { create } from "zustand"
import type {
  ParentChildRelationship,
  PersonIdentity,
  TreeMember,
  TreeParentChildRelationship,
  TreeUnion,
  Union,
  UnionEvent,
} from "../types"
import type {
  PersistedConflict,
  PersistedOperationConflict,
} from "./persistence"
import type { GlobalState, SyncStatus, TreeMeta } from "./state"

// ---------------------------------------------------------------------------
// Reactive store (Zustand). Mirrors the engine's reactive singletons in
// `state.ts` so React subscribes via selectors. The module-scoped `let`
// bindings there remain the source of truth; `notifyListeners` pushes their
// current values here, and subscribers re-render only when their selected
// slice actually changes (Object.is per selector), matching the previous
// `useSyncExternalStore` model.
// ---------------------------------------------------------------------------

export type ReactiveState = {
  state: GlobalState
  hydrated: boolean
  syncStatus: SyncStatus
  freshlyLoadedTrees: Set<string>
  syncConflicts: PersistedConflict[]
  operationConflicts: PersistedOperationConflict[]
  ancestorTreeLinks: Map<string, Map<string, string>>
  blockedChangesVersion: number
}

function emptyState(): GlobalState {
  return {
    persons: {},
    index: [],
    treeMembers: {},
    unions: {},
    unionEvents: {},
    treeUnions: {},
    parentChildRelationships: {},
    treeParentChildRelationships: {},
  }
}

export const useStore = create<ReactiveState>(() => ({
  state: emptyState(),
  hydrated: false,
  syncStatus: "saved" as SyncStatus,
  freshlyLoadedTrees: new Set(),
  syncConflicts: [],
  operationConflicts: [],
  ancestorTreeLinks: new Map(),
  blockedChangesVersion: 0,
}))

const emptyAncestorTreeLinks = new Map<string, string>()

export function useGraph(): GlobalState {
  return useStore((selector) => selector.state)
}

/**
 * Narrow collection selectors. Each subscribes to one collection only, so a
 * component re-renders when that collection's reference changes (structural
 * sharing means surgical edits leave untouched collections' references stable)
 * rather than on every store update the way `useGraph` does. This keeps
 * per-node hooks like `useMemberTrees`/`useAncestorTree` from re-rendering
 * every card on unrelated writes (e.g. typing in a name, periodic sync).
 */
export function useTreeMembers(): Record<string, TreeMember> {
  return useStore((selector) => selector.state.treeMembers)
}

export function usePersons(): Record<string, PersonIdentity> {
  return useStore((selector) => selector.state.persons)
}

export function useTrees(): TreeMeta[] {
  return useStore((selector) => selector.state.index)
}

export function useUnions(): Record<string, Union> {
  return useStore((selector) => selector.state.unions)
}

export function useUnionEvents(): Record<string, UnionEvent> {
  return useStore((selector) => selector.state.unionEvents)
}

export function useTreeUnions(): Record<string, TreeUnion> {
  return useStore((selector) => selector.state.treeUnions)
}

export function useParentChildRelationships(): Record<
  string,
  ParentChildRelationship
> {
  return useStore((selector) => selector.state.parentChildRelationships)
}

export function useTreeParentChildRelationships(): Record<
  string,
  TreeParentChildRelationship
> {
  return useStore((selector) => selector.state.treeParentChildRelationships)
}

export function useAncestorTreeLinks(treeId: string): Map<string, string> {
  return useStore(
    (selector) =>
      selector.ancestorTreeLinks.get(treeId) ?? emptyAncestorTreeLinks,
  )
}

export function useHydrated(): boolean {
  return useStore((selector) => selector.hydrated)
}

/**
 * True once the tree has received a fresh server snapshot during the current
 * store generation (i.e. `applyTreeSnapshot` has run for it this session).
 * Used to hold the tree view on its loading state until the first visible
 * frame is the authoritative server state, not stale persisted data.
 */
export function useTreeFreshlyLoaded(treeId: string): boolean {
  return useStore((selector) => selector.freshlyLoadedTrees.has(treeId))
}

export function useSyncStatus(): SyncStatus {
  return useStore((selector) => selector.syncStatus)
}

export function useSyncConflictCount(): number {
  return useStore((selector) => selector.syncConflicts.length)
}
