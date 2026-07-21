import { useCallback, useMemo, useSyncExternalStore } from "react"
import type { PersonWire, TreeWire } from "./sync/types"
import {
  descendantsOf,
  emptyEdges,
  type FamilyData,
  type Gender,
  type ParentLink,
  type PersonIdentity,
  type PersonInput,
  projectTree,
  type Relationship,
  type TreeEdges,
} from "./types"

export type ShareRole = "viewer" | "editor"
export type LocalRole = "owner" | ShareRole

export interface TreeMeta {
  id: string
  name: string
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp of the last local-or-remote edit; stamped by the sync seam. */
  updatedAt?: string
  /** Owner user id (set when a record arrived from the server). */
  ownerId?: string
  /** Owner email (set when a tree arrived via a share; null/undefined for own trees). */
  ownerEmail?: string | null
  /** Sharing role the current user has on this tree ("owner" for own trees). */
  role?: LocalRole
}

export interface GlobalState {
  /** One record per human; identity only (no relationship edges). */
  persons: Record<string, PersonIdentity>
  /** Per-tree relationship edges, keyed by tree id. */
  trees: Record<string, TreeEdges>
  index: TreeMeta[]
}

function newId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Legacy import (JSON export) normalisation — kept so Import JSON still works.
// ---------------------------------------------------------------------------

/** Shape of a v1 record — only `id` is required, the rest is best-effort. */
type LegacyPerson = Partial<{
  id: string
  name: string
  dob: string
  dod: string
  gender: Gender
  location: string
  photo: string
  parentIds: string[]
  spouseId: string
  parents: ParentLink[]
  spouseIds: string[]
}>

/** v1 stored `parentIds: string[]` and a single `spouseId`. */
function migrateLegacy(old: Record<string, LegacyPerson>): FamilyData {
  const next: FamilyData = {}
  for (const p of Object.values(old)) {
    if (!p || typeof p.id !== "string") continue
    next[p.id] = {
      id: p.id,
      name: p.name ?? "",
      dob: p.dob,
      dod: p.dod,
      gender: p.gender,
      location: p.location,
      photo: p.photo,
      parents: Array.isArray(p.parentIds)
        ? p.parentIds.map((id) => ({ id }))
        : (p.parents ?? []),
      spouseIds: p.spouseId ? [p.spouseId] : (p.spouseIds ?? []),
    }
  }
  return next
}

export function normalizeImport(data: Record<string, unknown>): FamilyData {
  const looksLegacy = Object.values(data).some((p) => {
    const candidate = p as LegacyPerson | null | undefined
    return (
      Array.isArray(candidate?.parentIds) || candidate?.spouseId !== undefined
    )
  })
  return looksLegacy
    ? migrateLegacy(data as Record<string, LegacyPerson>)
    : (data as FamilyData)
}

// ---------------------------------------------------------------------------
// Sync seam: in-memory dirty-id tracking + remote-merge entry point.
//
// Mutators funnel through `update()`, which diffs prev vs next by reference
// equality (every mutator creates a fresh object ref for the record it
// touched). Each changed/added/removed record gets stamped with `updatedAt`
// (if missing), enqueued, and the diff is POSTed to /api/sync. Remote merges
// (initial pull) bypass the queue.
// ---------------------------------------------------------------------------

export type DirtyAction = "upsert" | "delete"
export type DirtyMap = Map<string, DirtyAction>

let dirtyPersons: DirtyMap = new Map()
let dirtyTrees: DirtyMap = new Map()

/**
 * Stamp `updatedAt` on every changed record (ref-equality diff) and enqueue
 * those ids for the next push. Returns the next state with stamps applied.
 * Called from `update()` for local mutations only — remote merges bypass it.
 */
function stampAndEnqueue(prev: GlobalState, next: GlobalState): GlobalState {
  if (prev === next) return next
  const now = new Date().toISOString()

  // --- persons: ref-changed → upsert; removed → delete ---
  // Every local mutation must refresh `updatedAt` so the change wins the
  // server's last-write-wins comparison. Only re-stamping missing values
  // would leave edits to already-synced records with a stale timestamp and
  // the server would silently drop them.
  let persons = next.persons
  if (persons !== prev.persons) {
    const stamped: Record<string, PersonIdentity> = { ...persons }
    let changed = false
    for (const [id, p] of Object.entries(persons)) {
      if (p !== prev.persons[id]) {
        stamped[id] = { ...p, updatedAt: now }
        changed = true
        dirtyPersons.set(id, "upsert")
      }
    }
    for (const id of Object.keys(prev.persons)) {
      if (!persons[id]) dirtyPersons.set(id, "delete")
    }
    if (changed) persons = stamped
  }

  // --- trees: a tree changed if its index entry ref OR its edges ref changed ---
  let index = next.index
  if (index !== prev.index || next.trees !== prev.trees) {
    const prevMetaById = new Map(prev.index.map((t) => [t.id, t] as const))
    const stamped: TreeMeta[] = new Array(index.length)
    let changed = false
    for (let i = 0; i < index.length; i++) {
      const meta = index[i]
      if (meta === undefined) continue
      const oldMeta = prevMetaById.get(meta.id)
      const edgesChanged = next.trees[meta.id] !== prev.trees[meta.id]
      const metaChanged = meta !== oldMeta
      if (metaChanged || edgesChanged) {
        dirtyTrees.set(meta.id, "upsert")
        stamped[i] = { ...meta, updatedAt: now }
        changed = true
      } else {
        stamped[i] = meta
      }
    }
    for (const t of prev.index) {
      if (!prevMetaById.has(t.id)) continue // safety
    }
    for (const old of prev.index) {
      if (!index.some((t) => t.id === old.id)) dirtyTrees.set(old.id, "delete")
    }
    if (changed) index = stamped
  }

  return { ...next, persons, index }
}

interface UpdateOptions {
  /** True when the change originates from a server pull — don't enqueue dirty. */
  remote?: boolean
}

function update(
  updater: (prev: GlobalState) => GlobalState,
  opts?: UpdateOptions,
): void {
  const prev = state
  const next = updater(prev)
  if (next === prev) return
  const finalState = opts?.remote ? next : stampAndEnqueue(prev, next)
  state = finalState
  for (const l of listeners) l()
  if (!opts?.remote) void pushDirty()
}

/** Exposed for tests to seed state directly via the remote path. */
export function getSnapshot(): GlobalState {
  return state
}

export function snapshotDirty(): { persons: DirtyMap; trees: DirtyMap } {
  return {
    persons: new Map(dirtyPersons),
    trees: new Map(dirtyTrees),
  }
}

export function clearDirty(ids: {
  persons?: Iterable<string>
  trees?: Iterable<string>
}): void {
  for (const id of ids.persons ?? []) dirtyPersons.delete(id)
  for (const id of ids.trees ?? []) dirtyTrees.delete(id)
}

/**
 * POST the current dirty diff to /api/sync (fire-and-forget). On success the
 * shipped records are cleared from the dirty maps. Failures are logged and the
 * ids stay dirty, but with no persistence they're lost on the next reload.
 */
async function pushDirty(): Promise<void> {
  const dirty = snapshotDirty()
  const snapshot = getSnapshot()
  const now = new Date().toISOString()

  const personWires: PersonWire[] = []
  for (const [id, action] of dirty.persons) {
    const p = snapshot.persons[id]
    if (action === "delete" || !p) {
      personWires.push({
        id,
        name: "",
        updatedAt: p?.updatedAt ?? now,
        deletedAt: now,
      })
    } else {
      personWires.push({
        id,
        name: p.name,
        dob: p.dob,
        dod: p.dod,
        gender: p.gender,
        location: p.location,
        photo: p.photo,
        updatedAt: p.updatedAt ?? now,
      })
    }
  }

  const treeWires: TreeWire[] = []
  for (const [id, action] of dirty.trees) {
    const meta = snapshot.index.find((t) => t.id === id)
    const edges = snapshot.trees[id] ?? emptyEdges()
    if (action === "delete" || !meta) {
      if (!meta) continue // never existed locally; nothing to tell the server
      treeWires.push({
        id,
        name: meta.name,
        edges: emptyEdges() as TreeEdges,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt ?? now,
        deletedAt: now,
        ownerId: meta.ownerId ?? "",
      })
    } else {
      treeWires.push({
        id,
        name: meta.name,
        edges,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt ?? now,
        ownerId: meta.ownerId ?? "",
      })
    }
  }

  if (personWires.length === 0 && treeWires.length === 0) return

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persons: personWires, trees: treeWires }),
    })
    if (!res.ok) throw new Error(`push failed: ${res.status}`)
    clearDirty({
      persons: [...dirty.persons.keys()],
      trees: [...dirty.trees.keys()],
    })
  } catch (err) {
    console.error("sync push failed", err)
  }
}

/**
 * Merge records fetched from the server into the store. Newer `updatedAt`
 * wins; tombstones (`deletedAt`) remove the local record. Runs as a remote
 * update so it does NOT enqueue dirty ids — the server is the source of
 * these changes, pushing them back would loop.
 */
export function applyRemote(remote: {
  persons?: Iterable<PersonWire>
  trees?: Iterable<TreeWire>
}): void {
  update(
    (prev) => {
      let persons = prev.persons
      if (remote.persons) {
        for (const w of remote.persons) {
          const local = persons[w.id]
          if (w.deletedAt) {
            if (local) persons = { ...persons }
            if (local) delete persons[w.id]
            continue
          }
          if (!local || (local.updatedAt ?? "") < w.updatedAt) {
            if (persons === prev.persons) persons = { ...persons }
            persons[w.id] = {
              id: w.id,
              name: w.name,
              dob: w.dob,
              dod: w.dod,
              gender: w.gender as PersonIdentity["gender"],
              location: w.location,
              photo: w.photo,
              updatedAt: w.updatedAt,
            }
          }
        }
      }

      let trees = prev.trees
      let index = prev.index
      if (remote.trees) {
        const indexById = new Map(index.map((t) => [t.id, t] as const))
        let indexChanged = false
        let treesChanged = false
        for (const w of remote.trees) {
          const localMeta = indexById.get(w.id)
          if (w.deletedAt) {
            if (localMeta) {
              index = index.filter((t) => t.id !== w.id)
              indexById.delete(w.id)
              indexChanged = true
            }
            if (trees[w.id]) {
              trees = { ...trees }
              delete trees[w.id]
              treesChanged = true
            }
            continue
          }
          if (!localMeta || (localMeta.updatedAt ?? "") < w.updatedAt) {
            if (!indexChanged) {
              index = [...index]
              indexChanged = true
            }
            const replacement: TreeMeta = {
              id: w.id,
              name: w.name,
              createdAt: w.createdAt,
              updatedAt: w.updatedAt,
              ownerId: w.ownerId,
              ownerEmail: w.ownerEmail ?? localMeta?.ownerEmail,
              role: w.role ?? localMeta?.role,
            }
            const existingPos = index.findIndex((t) => t.id === w.id)
            if (existingPos >= 0) index[existingPos] = replacement
            else index.push(replacement)
            indexById.set(w.id, replacement)

            if (trees === prev.trees) trees = { ...trees }
            trees[w.id] = w.edges
            treesChanged = true
          }
        }
        if (indexChanged || treesChanged) {
          return { ...prev, persons, trees, index }
        }
      }

      if (persons === prev.persons) return prev
      return { ...prev, persons, trees, index }
    },
    { remote: true },
  )
}

// ---------------------------------------------------------------------------
// In-memory store + React binding (useSyncExternalStore gives cross-tree
// updates: editing a person in one tree re-renders every other tree they
// belong to). The store starts empty; Providers hydrates it from the server
// once a session is available.
// ---------------------------------------------------------------------------

let state: GlobalState = { persons: {}, trees: {}, index: [] }
let hydrated = false
const listeners = new Set<() => void>()

function getGraph(): GlobalState {
  return state
}
function getHydrated(): boolean {
  return hydrated
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Mark the store as having received its initial server pull. Pages use this
 * to distinguish "loading" from "empty account".
 */
export function setHydrated(value: boolean): void {
  if (hydrated === value) return
  hydrated = value
  for (const l of listeners) l()
}

/**
 * Empty the in-memory store + dirty maps and mark unhydrated. Called on
 * sign-out so a previous user's data does not leak into the next session.
 */
export function resetStore(): void {
  state = { persons: {}, trees: {}, index: [] }
  dirtyPersons = new Map()
  dirtyTrees = new Map()
  setHydrated(false)
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated)
}

// --- edge helpers (mutate a cloned TreeEdges) ---

function cloneTree(e: TreeEdges): TreeEdges {
  return {
    members: [...e.members],
    spouses: [...e.spouses],
    parents: { ...e.parents },
  }
}

function addMember(e: TreeEdges, id: string): void {
  if (!e.members.includes(id)) e.members.push(id)
}

function pairHas(e: TreeEdges, a: string, b: string): boolean {
  return e.spouses.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  )
}

function addSpouseEdge(e: TreeEdges, a: string, b: string): void {
  if (a !== b && !pairHas(e, a, b)) e.spouses.push([a, b])
}

function removeSpouseEdge(e: TreeEdges, a: string, b: string): void {
  e.spouses = e.spouses.filter(
    ([x, y]) => !((x === a && y === b) || (x === b && y === a)),
  )
}

function addParentEdge(
  e: TreeEdges,
  childId: string,
  parentId: string,
  adopted?: boolean,
): void {
  const list = e.parents[childId] ?? (e.parents[childId] = [])
  if (list.length >= 2 || list.some((l) => l.id === parentId)) return
  list.push({ id: parentId, adopted: adopted || undefined })
}

function removeParentEdge(
  e: TreeEdges,
  childId: string,
  parentId: string,
): void {
  const list = e.parents[childId]
  if (!list) return
  const next = list.filter((l) => l.id !== parentId)
  if (next.length === 0) delete e.parents[childId]
  else e.parents[childId] = next
}

export function rewriteEdges(
  e: TreeEdges,
  keep: string,
  drop: string,
): TreeEdges {
  const mapId = (id: string): string => (id === drop ? keep : id)
  const members: string[] = []
  const seenMember = new Set<string>()
  for (const m of e.members) {
    const id = mapId(m)
    if (!seenMember.has(id)) {
      seenMember.add(id)
      members.push(id)
    }
  }
  const spouses: [string, string][] = []
  const seenPair = new Set<string>()
  for (const [a, b] of e.spouses) {
    const x = mapId(a)
    const y = mapId(b)
    if (x === y) continue
    const key = x < y ? `${x}:${y}` : `${y}:${x}`
    if (seenPair.has(key)) continue
    seenPair.add(key)
    spouses.push([x, y])
  }
  const parents: Record<string, ParentLink[]> = {}
  for (const [cid, links] of Object.entries(e.parents)) {
    const childId = mapId(cid)
    const existing = parents[childId]
    const acc = existing ? [...existing] : []
    for (const l of links) {
      const pid = mapId(l.id)
      if (pid === childId || acc.some((o) => o.id === pid) || acc.length >= 2)
        continue
      acc.push({ id: pid, adopted: l.adopted })
    }
    if (acc.length) parents[childId] = acc
  }
  return { members, spouses, parents }
}

export function propagateSurvivor(
  trees: Record<string, TreeEdges>,
  keepId: string,
): Record<string, TreeEdges> {
  const spouseIds = new Set<string>()
  const parentIds = new Set<string>()
  const childIds = new Set<string>()
  for (const e of Object.values(trees)) {
    for (const [a, b] of e.spouses) {
      if (a === keepId) spouseIds.add(b)
      else if (b === keepId) spouseIds.add(a)
    }
    for (const l of e.parents[keepId] ?? []) parentIds.add(l.id)
    for (const [cid, links] of Object.entries(e.parents)) {
      if (links.some((l) => l.id === keepId)) childIds.add(cid)
    }
  }
  for (const e of Object.values(trees)) {
    if (!e.members.includes(keepId)) continue
    for (const sid of spouseIds) {
      addMember(e, sid)
      addSpouseEdge(e, keepId, sid)
    }
    for (const pid of parentIds) {
      addMember(e, pid)
      addParentEdge(e, keepId, pid)
    }
    for (const cid of childIds) {
      addMember(e, cid)
      addParentEdge(e, cid, keepId)
    }
  }
  return trees
}

// --- queries (pure, on a prev state) ---

function treesWithMember(
  s: GlobalState,
  id: string,
  exclude?: string,
): string[] {
  const out: string[] = []
  for (const t of s.index) {
    if (t.id === exclude) continue
    if (s.trees[t.id]?.members.includes(id)) out.push(t.id)
  }
  return out
}

function treesContainingAll(
  s: GlobalState,
  ids: string[],
  exclude?: string,
): string[] {
  const out: string[] = []
  for (const t of s.index) {
    if (t.id === exclude) continue
    const e = s.trees[t.id]
    if (e && ids.every((id) => e.members.includes(id))) out.push(t.id)
  }
  return out
}

/** Clones each touched tree at most once per update. */
function makeDraft(prev: GlobalState) {
  const cloned = new Map<string, TreeEdges>()
  return {
    next: {
      persons: { ...prev.persons },
      trees: { ...prev.trees },
      index: prev.index,
    } as GlobalState,
    tree(tid: string): TreeEdges {
      let e = cloned.get(tid)
      if (!e) {
        e = cloneTree(prev.trees[tid] ?? emptyEdges())
        cloned.set(tid, e)
        this.next.trees[tid] = e
      }
      return e
    },
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface TreeSeed {
  persons: Record<string, PersonIdentity>
  edges: TreeEdges
}

export function seedData(): TreeSeed {
  const grandpa = newId()
  const grandma = newId()
  const dad = newId()
  const mom = newId()
  const kid = newId()
  const persons: Record<string, PersonIdentity> = {
    [grandpa]: {
      id: grandpa,
      name: "Henry Tan",
      gender: "male",
      dob: "1948-03-02",
      dod: "2019-05-20",
      location: "Penang",
    },
    [grandma]: {
      id: grandma,
      name: "Mei Ling",
      gender: "female",
      dob: "1952-11-19",
      location: "Penang",
    },
    [dad]: {
      id: dad,
      name: "David Tan",
      gender: "male",
      dob: "1976-06-30",
      location: "Kuala Lumpur",
    },
    [mom]: {
      id: mom,
      name: "Sarah Lim",
      gender: "female",
      dob: "1979-01-15",
      location: "Kuala Lumpur",
    },
    [kid]: {
      id: kid,
      name: "Alex Tan",
      dob: "2008-09-05",
      location: "Singapore",
    },
  }
  const edges: TreeEdges = {
    members: [grandpa, grandma, dad, mom, kid],
    spouses: [
      [grandpa, grandma],
      [dad, mom],
    ],
    parents: {
      [dad]: [{ id: grandpa }, { id: grandma }],
      [kid]: [{ id: dad }, { id: mom }],
    },
  }
  return { persons, edges }
}

export function useTreeIndex() {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph)

  const createTree = useCallback((name: string, seed?: TreeSeed): string => {
    const id = newId()
    update((prev) => ({
      ...prev,
      index: [...prev.index, { id, name, createdAt: new Date().toISOString() }],
      trees: {
        ...prev.trees,
        [id]: seed ? cloneTree(seed.edges) : emptyEdges(),
      },
      persons: seed ? { ...prev.persons, ...seed.persons } : prev.persons,
    }))
    return id
  }, [])

  const renameTree = useCallback((id: string, name: string) => {
    update((prev) => ({
      ...prev,
      index: prev.index.map((t) => (t.id === id ? { ...t, name } : t)),
    }))
  }, [])

  const deleteTree = useCallback((id: string) => {
    update((prev) => {
      const trees = { ...prev.trees }
      delete trees[id]
      return { ...prev, trees, index: prev.index.filter((t) => t.id !== id) }
    })
  }, [])

  return { trees: g.index, createTree, renameTree, deleteTree }
}

export type TreeIndexStore = ReturnType<typeof useTreeIndex>

export function countMembers(treeId: string): number {
  return (state.trees[treeId]?.members ?? []).length
}

/** Every tree a person is a member of (for the "also appears in" badges). */
export function useMemberTrees(personId: string): TreeMeta[] {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(
    () =>
      g.index.filter((t) => (g.trees[t.id]?.members ?? []).includes(personId)),
    [g, personId],
  )
}

/** Members of a tree (id + name) — used by the cross-tree spouse picker. */
export function useMembersOf(
  treeId: string | undefined,
): { id: string; name: string }[] {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph)
  return useMemo(() => {
    if (!treeId) return []
    const members = g.trees[treeId]?.members ?? []
    return members.map((id) => ({ id, name: g.persons[id]?.name ?? "?" }))
  }, [g, treeId])
}

export function useFamily(treeId: string) {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph)
  const people = useMemo(
    () => projectTree(g.persons, g.trees[treeId] ?? emptyEdges()),
    [g, treeId],
  )
  const readOnly = useMemo(() => {
    const meta = g.index.find((t) => t.id === treeId)
    return meta?.role === "viewer"
  }, [g, treeId])

  const addPerson = useCallback(
    (input: PersonInput, rel: Relationship): string => {
      const id = newId()
      update((prev) => {
        const d = makeDraft(prev)
        d.next.persons[id] = {
          id,
          name: input.name,
          dob: input.dob,
          dod: input.dod,
          gender: input.gender,
          location: input.location,
          photo: input.photo,
        }
        const cur = d.tree(treeId)
        addMember(cur, id)

        if (rel.kind === "spouse") {
          addSpouseEdge(cur, id, rel.partnerId)
          for (const tid of treesWithMember(prev, rel.partnerId, treeId)) {
            const t = d.tree(tid)
            addMember(t, id)
            addSpouseEdge(t, id, rel.partnerId)
          }
        } else if (rel.kind === "child") {
          const parentIds = [rel.parentId, rel.otherParentId].filter(
            (x): x is string => !!x,
          )
          for (const pid of parentIds) addParentEdge(cur, id, pid, rel.adopted)
          // A child joins every tree that contains all of its parents.
          for (const tid of treesContainingAll(prev, parentIds, treeId)) {
            const t = d.tree(tid)
            addMember(t, id)
            for (const pid of parentIds) addParentEdge(t, id, pid, rel.adopted)
          }
        } else if (rel.kind === "parent") {
          addParentEdge(cur, rel.childId, id)
          if (rel.marryExisting) {
            const existing = (cur.parents[rel.childId] ?? []).find(
              (l) => l.id !== id,
            )
            if (existing) {
              addSpouseEdge(cur, id, existing.id)
              for (const tid of treesWithMember(prev, existing.id, treeId)) {
                const t = d.tree(tid)
                addMember(t, id)
                addSpouseEdge(t, id, existing.id)
              }
            }
          }
        }
        return d.next
      })
      return id
    },
    [treeId],
  )

  const updatePerson = useCallback((id: string, input: PersonInput) => {
    update((prev) => {
      const p = prev.persons[id]
      if (!p) return prev
      return { ...prev, persons: { ...prev.persons, [id]: { ...p, ...input } } }
    })
  }, [])

  const deletePerson = useCallback((id: string) => {
    update((prev) => {
      if (!prev.persons[id]) return prev
      const persons = { ...prev.persons }
      delete persons[id]
      const trees: Record<string, TreeEdges> = {}
      for (const [tid, e] of Object.entries(prev.trees)) {
        trees[tid] = {
          members: e.members.filter((m) => m !== id),
          spouses: e.spouses.filter(([a, b]) => a !== id && b !== id),
          parents: Object.fromEntries(
            Object.entries(e.parents)
              .filter(([cid]) => cid !== id)
              .map(
                ([cid, links]) =>
                  [cid, links.filter((l) => l.id !== id)] as const,
              )
              .filter(([, links]) => links.length > 0),
          ),
        }
      }
      return { ...prev, persons, trees }
    })
  }, [])

  const mergePersons = useCallback((keepId: string, dropId: string) => {
    update((prev) => {
      const keep = prev.persons[keepId]
      const drop = prev.persons[dropId]
      if (keepId === dropId || !keep || !drop) return prev
      const persons = { ...prev.persons }
      persons[keepId] = {
        id: keepId,
        name: keep.name || drop.name,
        dob: keep.dob ?? drop.dob,
        dod: keep.dod ?? drop.dod,
        gender: keep.gender ?? drop.gender,
        location: keep.location ?? drop.location,
        photo: keep.photo ?? drop.photo,
      }
      delete persons[dropId]
      const trees: Record<string, TreeEdges> = {}
      for (const [tid, e] of Object.entries(prev.trees)) {
        trees[tid] = rewriteEdges(e, keepId, dropId)
      }
      propagateSurvivor(trees, keepId)
      return { ...prev, persons, trees }
    })
  }, [])

  const linkSpouse = useCallback(
    (aId: string, bId: string) => {
      update((prev) => {
        if (aId === bId || !prev.persons[aId] || !prev.persons[bId]) return prev
        const d = makeDraft(prev)
        addSpouseEdge(d.tree(treeId), aId, bId)
        for (const tid of treesContainingAll(prev, [aId, bId], treeId)) {
          addSpouseEdge(d.tree(tid), aId, bId)
        }
        return d.next
      })
    },
    [treeId],
  )

  const unlinkSpouse = useCallback((aId: string, bId: string) => {
    update((prev) => {
      const d = makeDraft(prev)
      for (const t of prev.index) {
        const e = prev.trees[t.id]
        if (e && pairHas(e, aId, bId)) removeSpouseEdge(d.tree(t.id), aId, bId)
      }
      return d.next
    })
  }, [])

  const addParent = useCallback(
    (childId: string, parentId: string) => {
      update((prev) => {
        if (
          !prev.persons[childId]
          || !prev.persons[parentId]
          || childId === parentId
        ) {
          return prev
        }
        // Refuse a link that would make someone their own ancestor (per this tree).
        const fam = projectTree(
          prev.persons,
          prev.trees[treeId] ?? emptyEdges(),
        )
        if (descendantsOf(fam, childId).has(parentId)) return prev

        const d = makeDraft(prev)
        const cur = d.tree(treeId)
        addParentEdge(cur, childId, parentId)
        const allParents = (cur.parents[childId] ?? []).map((l) => l.id)
        for (const tid of treesContainingAll(prev, allParents, treeId)) {
          const t = d.tree(tid)
          addMember(t, childId)
          for (const pid of allParents) addParentEdge(t, childId, pid)
        }
        return d.next
      })
    },
    [treeId],
  )

  const removeParent = useCallback((childId: string, parentId: string) => {
    update((prev) => {
      const d = makeDraft(prev)
      for (const t of prev.index) {
        const e = prev.trees[t.id]
        if (e?.parents[childId]?.some((l) => l.id === parentId)) {
          removeParentEdge(d.tree(t.id), childId, parentId)
        }
      }
      return d.next
    })
  }, [])

  const setParentAdopted = useCallback(
    (childId: string, parentId: string, adopted: boolean) => {
      update((prev) => {
        const d = makeDraft(prev)
        for (const t of prev.index) {
          const e = prev.trees[t.id]
          if (!e?.parents[childId]?.some((l) => l.id === parentId)) continue
          const te = d.tree(t.id)
          const list = te.parents[childId] ?? (te.parents[childId] = [])
          te.parents[childId] = list.map((l) =>
            l.id === parentId ? { ...l, adopted: adopted || undefined } : l,
          )
        }
        return d.next
      })
    },
    [],
  )

  /** Marry a person in this tree to a person in another tree (single config:
   *  each becomes a member of the other's tree, and the marriage shows in both). */
  const linkAcrossTrees = useCallback(
    (personId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return
      update((prev) => {
        if (!prev.persons[personId] || !prev.persons[otherPersonId]) return prev
        const d = makeDraft(prev)
        const cur = d.tree(treeId)
        addMember(cur, otherPersonId)
        addSpouseEdge(cur, personId, otherPersonId)
        const other = d.tree(otherTreeId)
        addMember(other, personId)
        addSpouseEdge(other, personId, otherPersonId)
        // Any further tree that already had both members shows the marriage too.
        for (const t of prev.index) {
          if (t.id === treeId || t.id === otherTreeId) continue
          const e = prev.trees[t.id]
          if (
            e?.members.includes(personId)
            && e.members.includes(otherPersonId)
          ) {
            addSpouseEdge(d.tree(t.id), personId, otherPersonId)
          }
        }
        return d.next
      })
    },
    [treeId],
  )

  /** Drop a person from one tree only (membership + that tree's edges). */
  const removeFromTree = useCallback(
    (personId: string, targetTreeId: string) => {
      update((prev) => {
        const e = prev.trees[targetTreeId]
        if (!e?.members.includes(personId)) return prev
        const parents: Record<string, ParentLink[]> = {}
        for (const [cid, links] of Object.entries(e.parents)) {
          if (cid === personId) continue
          const filtered = links.filter((l) => l.id !== personId)
          if (filtered.length) parents[cid] = filtered
        }
        return {
          ...prev,
          trees: {
            ...prev.trees,
            [targetTreeId]: {
              members: e.members.filter((m) => m !== personId),
              spouses: e.spouses.filter(
                ([a, b]) => a !== personId && b !== personId,
              ),
              parents,
            },
          },
        }
      })
    },
    [],
  )

  const replaceAll = useCallback(
    (data: FamilyData) => {
      update((prev) => {
        const persons = { ...prev.persons }
        const members: string[] = []
        const spouses: [string, string][] = []
        const parents: Record<string, ParentLink[]> = {}
        const seenPair = new Set<string>()
        for (const p of Object.values(data)) {
          persons[p.id] = {
            id: p.id,
            name: p.name,
            dob: p.dob,
            dod: p.dod,
            gender: p.gender,
            location: p.location,
            photo: p.photo,
          }
          members.push(p.id)
          if (p.parents.length)
            parents[p.id] = p.parents.map((l) => ({
              id: l.id,
              adopted: l.adopted,
            }))
          for (const sid of p.spouseIds) {
            if (p.id === sid) continue
            const key = p.id < sid ? `${p.id}:${sid}` : `${sid}:${p.id}`
            if (seenPair.has(key)) continue
            seenPair.add(key)
            spouses.push([p.id, sid])
          }
        }
        return {
          ...prev,
          persons,
          trees: { ...prev.trees, [treeId]: { members, spouses, parents } },
        }
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
    addParent,
    removeParent,
    setParentAdopted,
    linkAcrossTrees,
    removeFromTree,
    replaceAll,
  }
}

export type FamilyStore = ReturnType<typeof useFamily>
