import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  descendantsOf,
  emptyEdges,
  projectTree,
  type FamilyData,
  type ParentLink,
  type PersonIdentity,
  type PersonInput,
  type Relationship,
  type TreeEdges,
} from "./types";

const GRAPH_KEY = "family-graph-v1";
/** Pre-global keys: per-tree data + a tree index, plus single-tree legacies. */
const LEGACY_INDEX_KEY = "family-trees-index";
const LEGACY_TREE_PREFIX = "family-tree-v2:";
const LEGACY_V2_KEY = "family-tree-v2";
const LEGACY_V1_KEY = "family-tree-v1";

export interface TreeMeta {
  id: string;
  name: string;
  /** ISO timestamp */
  createdAt: string;
}

interface GlobalState {
  /** One record per human; identity only (no relationship edges). */
  persons: Record<string, PersonIdentity>;
  /** Per-tree relationship edges, keyed by tree id. */
  trees: Record<string, TreeEdges>;
  index: TreeMeta[];
}

function newId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Legacy import (JSON export) normalisation — kept so Import JSON still works.
// ---------------------------------------------------------------------------

/** v1 stored `parentIds: string[]` and a single `spouseId`. */
function migrateLegacy(old: Record<string, any>): FamilyData {
  const next: FamilyData = {};
  for (const p of Object.values(old) as any[]) {
    if (!p || typeof p.id !== "string") continue;
    next[p.id] = {
      id: p.id,
      name: p.name ?? "",
      dob: p.dob,
      dod: p.dod,
      gender: p.gender,
      location: p.location,
      photo: p.photo,
      parents: Array.isArray(p.parentIds)
        ? p.parentIds.map((id: string) => ({ id }))
        : (p.parents ?? []),
      spouseIds: p.spouseId ? [p.spouseId] : (p.spouseIds ?? []),
    };
  }
  return next;
}

export function normalizeImport(data: Record<string, any>): FamilyData {
  const looksLegacy = Object.values(data).some((p: any) => Array.isArray(p?.parentIds) || p?.spouseId);
  return looksLegacy ? migrateLegacy(data) : (data as FamilyData);
}

// ---------------------------------------------------------------------------
// One-time migration from the pre-global per-tree storage into a single graph.
// Persons that were cross-linked across trees are merged into one identity.
// ---------------------------------------------------------------------------

function readLegacyTree(treeId: string): FamilyData | null {
  try {
    const raw = localStorage.getItem(LEGACY_TREE_PREFIX + treeId);
    if (raw) return normalizeImport(JSON.parse(raw));
  } catch (err) {
    console.error("Failed to read legacy tree", err);
  }
  return null;
}

function legacyTreeToGlobal(index: TreeMeta[], perTree: Record<string, FamilyData>): GlobalState {
  // Union-find over person ids: a legacy `links` entry marks two ids (in
  // different trees) as the same person, so they collapse to one identity.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) && parent.get(cur) !== cur) cur = parent.get(cur)!;
    let n = x;
    while (parent.get(n) && parent.get(n) !== cur) {
      const nxt = parent.get(n)!;
      parent.set(n, cur);
      n = nxt;
    }
    return cur;
  };
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const rawIdent: Record<string, PersonIdentity> = {};
  const mergeInto = (dst: PersonIdentity, src: PersonIdentity): PersonIdentity => ({
    id: dst.id,
    name: dst.name || src.name,
    dob: dst.dob ?? src.dob,
    dod: dst.dod ?? src.dod,
    gender: dst.gender ?? src.gender,
    location: dst.location ?? src.location,
    photo: dst.photo ?? src.photo,
  });

  for (const data of Object.values(perTree)) {
    for (const p of Object.values(data)) {
      const ident: PersonIdentity = {
        id: p.id,
        name: p.name,
        dob: p.dob,
        dod: p.dod,
        gender: p.gender,
        location: p.location,
        photo: p.photo,
      };
      rawIdent[p.id] = rawIdent[p.id] ? mergeInto(rawIdent[p.id]!, ident) : ident;
      for (const link of (p as { links?: { personId: string }[] }).links ?? []) {
        union(p.id, link.personId);
      }
    }
  }

  const persons: Record<string, PersonIdentity> = {};
  for (const id of Object.keys(rawIdent)) {
    const root = find(id);
    const src = rawIdent[id]!;
    persons[root] = persons[root] ? mergeInto(persons[root]!, { ...src, id: root }) : { ...src, id: root };
  }
  const rootOf = (id: string) => {
    ensure(id);
    return find(id);
  };

  const trees: Record<string, TreeEdges> = {};
  for (const t of index) {
    const data = perTree[t.id];
    if (!data) {
      trees[t.id] = emptyEdges();
      continue;
    }
    const members: string[] = [];
    const memberSet = new Set<string>();
    const spouses: [string, string][] = [];
    const seenPair = new Set<string>();
    const parents: Record<string, ParentLink[]> = {};

    for (const p of Object.values(data)) {
      const r = rootOf(p.id);
      if (!memberSet.has(r)) {
        memberSet.add(r);
        members.push(r);
      }
    }
    for (const p of Object.values(data)) {
      const cr = rootOf(p.id);
      if (p.parents.length) {
        const links: ParentLink[] = [];
        for (const l of p.parents) {
          const pid = rootOf(l.id);
          if (pid !== cr && !links.some(x => x.id === pid) && links.length < 2) {
            links.push({ id: pid, adopted: l.adopted });
          }
        }
        if (links.length) parents[cr] = links;
      }
      for (const sid of p.spouseIds) {
        const sr = rootOf(sid);
        if (sr === cr) continue;
        const key = cr < sr ? `${cr}:${sr}` : `${sr}:${cr}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        spouses.push([cr, sr]);
      }
    }
    trees[t.id] = { members, spouses, parents };
  }

  return { persons, trees, index };
}

function migrateFromLegacy(): GlobalState {
  let index: TreeMeta[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_INDEX_KEY);
    if (raw) index = JSON.parse(raw) as TreeMeta[];
  } catch (err) {
    console.error("Failed to read legacy index", err);
  }

  if (index.length === 0) {
    const legacy = localStorage.getItem(LEGACY_V2_KEY) ?? localStorage.getItem(LEGACY_V1_KEY);
    if (legacy) {
      try {
        const data = normalizeImport(JSON.parse(legacy));
        const id = newId();
        index = [{ id, name: "My Family", createdAt: new Date().toISOString() }];
        return legacyTreeToGlobal(index, { [id]: data });
      } catch (err) {
        console.error("Failed to adopt legacy single tree", err);
      }
    }
    return { persons: {}, trees: {}, index: [] };
  }

  const perTree: Record<string, FamilyData> = {};
  for (const t of index) {
    const data = readLegacyTree(t.id);
    if (data) perTree[t.id] = data;
  }
  return legacyTreeToGlobal(index, perTree);
}

function loadGlobal(): GlobalState {
  try {
    const raw = localStorage.getItem(GRAPH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        persons: parsed.persons ?? {},
        trees: parsed.trees ?? {},
        index: parsed.index ?? [],
      };
    }
  } catch (err) {
    console.error("Failed to load graph, migrating", err);
  }
  const migrated = migrateFromLegacy();
  persistGraph(migrated);
  return migrated;
}

function persistGraph(s: GlobalState): void {
  try {
    localStorage.setItem(GRAPH_KEY, JSON.stringify(s));
  } catch (err) {
    console.error("Failed to persist graph", err);
  }
}

// ---------------------------------------------------------------------------
// Global store + React binding (useSyncExternalStore gives cross-tree updates:
// editing a person in one tree re-renders every other tree they belong to).
// ---------------------------------------------------------------------------

let state: GlobalState = loadGlobal();
const listeners = new Set<() => void>();

function getGraph(): GlobalState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(updater: (prev: GlobalState) => GlobalState): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  persistGraph(state);
  listeners.forEach(l => l());
}

// --- edge helpers (mutate a cloned TreeEdges) ---

function cloneTree(e: TreeEdges): TreeEdges {
  return { members: [...e.members], spouses: [...e.spouses], parents: { ...e.parents } };
}

function addMember(e: TreeEdges, id: string): void {
  if (!e.members.includes(id)) e.members.push(id);
}

function pairHas(e: TreeEdges, a: string, b: string): boolean {
  return e.spouses.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function addSpouseEdge(e: TreeEdges, a: string, b: string): void {
  if (a !== b && !pairHas(e, a, b)) e.spouses.push([a, b]);
}

function removeSpouseEdge(e: TreeEdges, a: string, b: string): void {
  e.spouses = e.spouses.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
}

function addParentEdge(e: TreeEdges, childId: string, parentId: string, adopted?: boolean): void {
  const list = e.parents[childId] ?? (e.parents[childId] = []);
  if (list.length >= 2 || list.some(l => l.id === parentId)) return;
  list.push({ id: parentId, adopted: adopted || undefined });
}

function removeParentEdge(e: TreeEdges, childId: string, parentId: string): void {
  const list = e.parents[childId];
  if (!list) return;
  const next = list.filter(l => l.id !== parentId);
  if (next.length === 0) delete e.parents[childId];
  else e.parents[childId] = next;
}

export function rewriteEdges(e: TreeEdges, keep: string, drop: string): TreeEdges {
  const mapId = (id: string): string => (id === drop ? keep : id);
  const members: string[] = [];
  const seenMember = new Set<string>();
  for (const m of e.members) {
    const id = mapId(m);
    if (!seenMember.has(id)) {
      seenMember.add(id);
      members.push(id);
    }
  }
  const spouses: [string, string][] = [];
  const seenPair = new Set<string>();
  for (const [a, b] of e.spouses) {
    const x = mapId(a);
    const y = mapId(b);
    if (x === y) continue;
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    spouses.push([x, y]);
  }
  const parents: Record<string, ParentLink[]> = {};
  for (const [cid, links] of Object.entries(e.parents)) {
    const childId = mapId(cid);
    const acc = parents[childId] ? [...parents[childId]!] : [];
    for (const l of links) {
      const pid = mapId(l.id);
      if (pid === childId || acc.some(o => o.id === pid) || acc.length >= 2) continue;
      acc.push({ id: pid, adopted: l.adopted });
    }
    if (acc.length) parents[childId] = acc;
  }
  return { members, spouses, parents };
}

export function propagateSurvivor(
  trees: Record<string, TreeEdges>,
  keepId: string,
): Record<string, TreeEdges> {
  const spouseIds = new Set<string>();
  const parentIds = new Set<string>();
  const childIds = new Set<string>();
  for (const e of Object.values(trees)) {
    for (const [a, b] of e.spouses) {
      if (a === keepId) spouseIds.add(b);
      else if (b === keepId) spouseIds.add(a);
    }
    for (const l of e.parents[keepId] ?? []) parentIds.add(l.id);
    for (const [cid, links] of Object.entries(e.parents)) {
      if (links.some(l => l.id === keepId)) childIds.add(cid);
    }
  }
  for (const e of Object.values(trees)) {
    if (!e.members.includes(keepId)) continue;
    for (const sid of spouseIds) {
      addMember(e, sid);
      addSpouseEdge(e, keepId, sid);
    }
    for (const pid of parentIds) {
      addMember(e, pid);
      addParentEdge(e, keepId, pid);
    }
    for (const cid of childIds) {
      addMember(e, cid);
      addParentEdge(e, cid, keepId);
    }
  }
  return trees;
}

// --- queries (pure, on a prev state) ---

function treesWithMember(s: GlobalState, id: string, exclude?: string): string[] {
  const out: string[] = [];
  for (const t of s.index) {
    if (t.id === exclude) continue;
    if (s.trees[t.id]?.members.includes(id)) out.push(t.id);
  }
  return out;
}

function treesContainingAll(s: GlobalState, ids: string[], exclude?: string): string[] {
  const out: string[] = [];
  for (const t of s.index) {
    if (t.id === exclude) continue;
    const e = s.trees[t.id];
    if (e && ids.every(id => e.members.includes(id))) out.push(t.id);
  }
  return out;
}

/** Clones each touched tree at most once per update. */
function makeDraft(prev: GlobalState) {
  const cloned = new Map<string, TreeEdges>();
  return {
    next: { persons: { ...prev.persons }, trees: { ...prev.trees }, index: prev.index } as GlobalState,
    tree(tid: string): TreeEdges {
      let e = cloned.get(tid);
      if (!e) {
        e = cloneTree(prev.trees[tid] ?? emptyEdges());
        cloned.set(tid, e);
        this.next.trees[tid] = e;
      }
      return e;
    },
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface TreeSeed {
  persons: Record<string, PersonIdentity>;
  edges: TreeEdges;
}

export function seedData(): TreeSeed {
  const grandpa = newId();
  const grandma = newId();
  const dad = newId();
  const mom = newId();
  const kid = newId();
  const persons: Record<string, PersonIdentity> = {
    [grandpa]: { id: grandpa, name: "Henry Tan", gender: "male", dob: "1948-03-02", dod: "2019-05-20", location: "Penang" },
    [grandma]: { id: grandma, name: "Mei Ling", gender: "female", dob: "1952-11-19", location: "Penang" },
    [dad]: { id: dad, name: "David Tan", gender: "male", dob: "1976-06-30", location: "Kuala Lumpur" },
    [mom]: { id: mom, name: "Sarah Lim", gender: "female", dob: "1979-01-15", location: "Kuala Lumpur" },
    [kid]: { id: kid, name: "Alex Tan", dob: "2008-09-05", location: "Singapore" },
  };
  const edges: TreeEdges = {
    members: [grandpa, grandma, dad, mom, kid],
    spouses: [[grandpa, grandma], [dad, mom]],
    parents: { [dad]: [{ id: grandpa }, { id: grandma }], [kid]: [{ id: dad }, { id: mom }] },
  };
  return { persons, edges };
}

export function useTreeIndex() {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph);

  const createTree = useCallback((name: string, seed?: TreeSeed): string => {
    const id = newId();
    update(prev => ({
      ...prev,
      index: [...prev.index, { id, name, createdAt: new Date().toISOString() }],
      trees: { ...prev.trees, [id]: seed ? cloneTree(seed.edges) : emptyEdges() },
      persons: seed ? { ...prev.persons, ...seed.persons } : prev.persons,
    }));
    return id;
  }, []);

  const renameTree = useCallback((id: string, name: string) => {
    update(prev => ({ ...prev, index: prev.index.map(t => (t.id === id ? { ...t, name } : t)) }));
  }, []);

  const deleteTree = useCallback((id: string) => {
    update(prev => {
      const trees = { ...prev.trees };
      delete trees[id];
      return { ...prev, trees, index: prev.index.filter(t => t.id !== id) };
    });
  }, []);

  return { trees: g.index, createTree, renameTree, deleteTree };
}

export type TreeIndexStore = ReturnType<typeof useTreeIndex>;

export function countMembers(treeId: string): number {
  return (state.trees[treeId]?.members ?? []).length;
}

/** Every tree a person is a member of (for the "also appears in" badges). */
export function useMemberTrees(personId: string): TreeMeta[] {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph);
  return useMemo(
    () => g.index.filter(t => (g.trees[t.id]?.members ?? []).includes(personId)),
    [g, personId],
  );
}

/** Members of a tree (id + name) — used by the cross-tree spouse picker. */
export function useMembersOf(treeId: string | undefined): { id: string; name: string }[] {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph);
  return useMemo(() => {
    if (!treeId) return [];
    const members = g.trees[treeId]?.members ?? [];
    return members.map(id => ({ id, name: g.persons[id]?.name ?? "?" }));
  }, [g, treeId]);
}

export function useFamily(treeId: string) {
  const g = useSyncExternalStore(subscribe, getGraph, getGraph);
  const people = useMemo(
    () => projectTree(g.persons, g.trees[treeId] ?? emptyEdges()),
    [g, treeId],
  );

  const addPerson = useCallback(
    (input: PersonInput, rel: Relationship): string => {
      const id = newId();
      update(prev => {
        const d = makeDraft(prev);
        d.next.persons[id] = {
          id,
          name: input.name,
          dob: input.dob,
          dod: input.dod,
          gender: input.gender,
          location: input.location,
          photo: input.photo,
        };
        const cur = d.tree(treeId);
        addMember(cur, id);

        if (rel.kind === "spouse") {
          addSpouseEdge(cur, id, rel.partnerId);
          for (const tid of treesWithMember(prev, rel.partnerId, treeId)) {
            const t = d.tree(tid);
            addMember(t, id);
            addSpouseEdge(t, id, rel.partnerId);
          }
        } else if (rel.kind === "child") {
          const parentIds = [rel.parentId, rel.otherParentId].filter((x): x is string => !!x);
          for (const pid of parentIds) addParentEdge(cur, id, pid, rel.adopted);
          // A child joins every tree that contains all of its parents.
          for (const tid of treesContainingAll(prev, parentIds, treeId)) {
            const t = d.tree(tid);
            addMember(t, id);
            for (const pid of parentIds) addParentEdge(t, id, pid, rel.adopted);
          }
        } else if (rel.kind === "parent") {
          addParentEdge(cur, rel.childId, id);
          if (rel.marryExisting) {
            const existing = (cur.parents[rel.childId] ?? []).find(l => l.id !== id);
            if (existing) {
              addSpouseEdge(cur, id, existing.id);
              for (const tid of treesWithMember(prev, existing.id, treeId)) {
                const t = d.tree(tid);
                addMember(t, id);
                addSpouseEdge(t, id, existing.id);
              }
            }
          }
        }
        return d.next;
      });
      return id;
    },
    [treeId],
  );

  const updatePerson = useCallback((id: string, input: PersonInput) => {
    update(prev => {
      const p = prev.persons[id];
      if (!p) return prev;
      return { ...prev, persons: { ...prev.persons, [id]: { ...p, ...input } } };
    });
  }, []);

  const deletePerson = useCallback((id: string) => {
    update(prev => {
      if (!prev.persons[id]) return prev;
      const persons = { ...prev.persons };
      delete persons[id];
      const trees: Record<string, TreeEdges> = {};
      for (const [tid, e] of Object.entries(prev.trees)) {
        trees[tid] = {
          members: e.members.filter(m => m !== id),
          spouses: e.spouses.filter(([a, b]) => a !== id && b !== id),
          parents: Object.fromEntries(
            Object.entries(e.parents)
              .filter(([cid]) => cid !== id)
              .map(([cid, links]) => [cid, links.filter(l => l.id !== id)] as const)
              .filter(([, links]) => links.length > 0),
          ),
        };
      }
      return { ...prev, persons, trees };
    });
  }, []);

  const mergePersons = useCallback((keepId: string, dropId: string) => {
    update(prev => {
      const keep = prev.persons[keepId];
      const drop = prev.persons[dropId];
      if (keepId === dropId || !keep || !drop) return prev;
      const persons = { ...prev.persons };
      persons[keepId] = {
        id: keepId,
        name: keep.name || drop.name,
        dob: keep.dob ?? drop.dob,
        dod: keep.dod ?? drop.dod,
        gender: keep.gender ?? drop.gender,
        location: keep.location ?? drop.location,
        photo: keep.photo ?? drop.photo,
      };
      delete persons[dropId];
      const trees: Record<string, TreeEdges> = {};
      for (const [tid, e] of Object.entries(prev.trees)) {
        trees[tid] = rewriteEdges(e, keepId, dropId);
      }
      propagateSurvivor(trees, keepId);
      return { ...prev, persons, trees };
    });
  }, []);

  const linkSpouse = useCallback(
    (aId: string, bId: string) => {
      update(prev => {
        if (aId === bId || !prev.persons[aId] || !prev.persons[bId]) return prev;
        const d = makeDraft(prev);
        addSpouseEdge(d.tree(treeId), aId, bId);
        for (const tid of treesContainingAll(prev, [aId, bId], treeId)) {
          addSpouseEdge(d.tree(tid), aId, bId);
        }
        return d.next;
      });
    },
    [treeId],
  );

  const unlinkSpouse = useCallback((aId: string, bId: string) => {
    update(prev => {
      const d = makeDraft(prev);
      for (const t of prev.index) {
        const e = prev.trees[t.id];
        if (e && pairHas(e, aId, bId)) removeSpouseEdge(d.tree(t.id), aId, bId);
      }
      return d.next;
    });
  }, []);

  const addParent = useCallback(
    (childId: string, parentId: string) => {
      update(prev => {
        if (
          !prev.persons[childId] ||
          !prev.persons[parentId] ||
          childId === parentId
        ) {
          return prev;
        }
        // Refuse a link that would make someone their own ancestor (per this tree).
        const fam = projectTree(prev.persons, prev.trees[treeId] ?? emptyEdges());
        if (descendantsOf(fam, childId).has(parentId)) return prev;

        const d = makeDraft(prev);
        const cur = d.tree(treeId);
        addParentEdge(cur, childId, parentId);
        const allParents = (cur.parents[childId] ?? []).map(l => l.id);
        for (const tid of treesContainingAll(prev, allParents, treeId)) {
          const t = d.tree(tid);
          addMember(t, childId);
          for (const pid of allParents) addParentEdge(t, childId, pid);
        }
        return d.next;
      });
    },
    [treeId],
  );

  const removeParent = useCallback((childId: string, parentId: string) => {
    update(prev => {
      const d = makeDraft(prev);
      for (const t of prev.index) {
        const e = prev.trees[t.id];
        if (e?.parents[childId]?.some(l => l.id === parentId)) {
          removeParentEdge(d.tree(t.id), childId, parentId);
        }
      }
      return d.next;
    });
  }, []);

  const setParentAdopted = useCallback((childId: string, parentId: string, adopted: boolean) => {
    update(prev => {
      const d = makeDraft(prev);
      for (const t of prev.index) {
        const e = prev.trees[t.id];
        if (!e?.parents[childId]?.some(l => l.id === parentId)) continue;
        const te = d.tree(t.id);
        const list = te.parents[childId] ?? (te.parents[childId] = []);
        te.parents[childId] = list.map(l =>
          l.id === parentId ? { ...l, adopted: adopted || undefined } : l,
        );
      }
      return d.next;
    });
  }, []);

  /** Marry a person in this tree to a person in another tree (single config:
   *  each becomes a member of the other's tree, and the marriage shows in both). */
  const linkAcrossTrees = useCallback(
    (personId: string, otherTreeId: string, otherPersonId: string) => {
      if (otherTreeId === treeId) return;
      update(prev => {
        if (!prev.persons[personId] || !prev.persons[otherPersonId]) return prev;
        const d = makeDraft(prev);
        const cur = d.tree(treeId);
        addMember(cur, otherPersonId);
        addSpouseEdge(cur, personId, otherPersonId);
        const other = d.tree(otherTreeId);
        addMember(other, personId);
        addSpouseEdge(other, personId, otherPersonId);
        // Any further tree that already had both members shows the marriage too.
        for (const t of prev.index) {
          if (t.id === treeId || t.id === otherTreeId) continue;
          const e = prev.trees[t.id];
          if (e && e.members.includes(personId) && e.members.includes(otherPersonId)) {
            addSpouseEdge(d.tree(t.id), personId, otherPersonId);
          }
        }
        return d.next;
      });
    },
    [treeId],
  );

  /** Drop a person from one tree only (membership + that tree's edges). */
  const removeFromTree = useCallback((personId: string, targetTreeId: string) => {
    update(prev => {
      const e = prev.trees[targetTreeId];
      if (!e?.members.includes(personId)) return prev;
      const parents: Record<string, ParentLink[]> = {};
      for (const [cid, links] of Object.entries(e.parents)) {
        if (cid === personId) continue;
        const filtered = links.filter(l => l.id !== personId);
        if (filtered.length) parents[cid] = filtered;
      }
      return {
        ...prev,
        trees: {
          ...prev.trees,
          [targetTreeId]: {
            members: e.members.filter(m => m !== personId),
            spouses: e.spouses.filter(([a, b]) => a !== personId && b !== personId),
            parents,
          },
        },
      };
    });
  }, []);

  const replaceAll = useCallback(
    (data: FamilyData) => {
      update(prev => {
        const persons = { ...prev.persons };
        const members: string[] = [];
        const spouses: [string, string][] = [];
        const parents: Record<string, ParentLink[]> = {};
        const seenPair = new Set<string>();
        for (const p of Object.values(data)) {
          persons[p.id] = {
            id: p.id,
            name: p.name,
            dob: p.dob,
            dod: p.dod,
            gender: p.gender,
            location: p.location,
            photo: p.photo,
          };
          members.push(p.id);
          if (p.parents.length) parents[p.id] = p.parents.map(l => ({ id: l.id, adopted: l.adopted }));
          for (const sid of p.spouseIds) {
            if (p.id === sid) continue;
            const key = p.id < sid ? `${p.id}:${sid}` : `${sid}:${p.id}`;
            if (seenPair.has(key)) continue;
            seenPair.add(key);
            spouses.push([p.id, sid]);
          }
        }
        return { ...prev, persons, trees: { ...prev.trees, [treeId]: { members, spouses, parents } } };
      });
    },
    [treeId],
  );

  return {
    people,
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
  };
}

export type FamilyStore = ReturnType<typeof useFamily>;

