import { create } from "zustand"
import type {
  PersistedConflict,
  PersistedOperationConflict,
} from "./persistence"
import type { GlobalState, SyncStatus } from "./state"
import { ancestorTreeLinksFor, emptyState } from "./state-internals"

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
function graphCollectionHook<Field extends keyof GlobalState>(
  field: Field,
): () => GlobalState[Field] {
  return () => useStore((selector) => selector.state[field])
}

export const usePersons = graphCollectionHook("persons")
export const useTreeMembers = graphCollectionHook("treeMembers")
export const useTrees = graphCollectionHook("index")
export const useUnions = graphCollectionHook("unions")
export const useUnionEvents = graphCollectionHook("unionEvents")
export const useTreeUnions = graphCollectionHook("treeUnions")
export const useParentChildRelationships = graphCollectionHook(
  "parentChildRelationships",
)
export const useTreeParentChildRelationships = graphCollectionHook(
  "treeParentChildRelationships",
)

export function useAncestorTreeLinks(treeId: string): Map<string, string> {
  return useStore((selector) =>
    ancestorTreeLinksFor(selector.ancestorTreeLinks, treeId),
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
