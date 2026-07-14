import { useCallback, useEffect, useState } from "react";
import { descendantsOf, type CrossLink, type FamilyData, type Person, type PersonInput, type Relationship } from "./types";

const INDEX_KEY = "family-trees-index";
const TREE_PREFIX = "family-tree-v2:";
/** Pre-multi-tree keys: a single unnamed tree. */
const LEGACY_V2_KEY = "family-tree-v2";
const LEGACY_KEY = "family-tree-v1";

export interface TreeMeta {
  id: string;
  name: string;
  /** ISO timestamp */
  createdAt: string;
}

function newId(): string {
  return crypto.randomUUID();
}

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

export function seedData(): FamilyData {
  const grandpa = newId();
  const grandma = newId();
  const dad = newId();
  const mom = newId();
  const kid = newId();
  const people: Person[] = [
    { id: grandpa, name: "Henry Tan", gender: "male", dob: "1948-03-02", dod: "2019-05-20", location: "Penang", parents: [], spouseIds: [grandma] },
    { id: grandma, name: "Mei Ling", gender: "female", dob: "1952-11-19", location: "Penang", parents: [], spouseIds: [grandpa] },
    { id: dad, name: "David Tan", gender: "male", dob: "1976-06-30", location: "Kuala Lumpur", parents: [{ id: grandpa }, { id: grandma }], spouseIds: [mom] },
    { id: mom, name: "Sarah Lim", gender: "female", dob: "1979-01-15", location: "Kuala Lumpur", parents: [], spouseIds: [dad] },
    { id: kid, name: "Alex Tan", dob: "2008-09-05", location: "Singapore", parents: [{ id: dad }, { id: mom }], spouseIds: [] },
  ];
  return Object.fromEntries(people.map(p => [p.id, p]));
}

function treeKey(treeId: string): string {
  return TREE_PREFIX + treeId;
}

function load(treeId: string): FamilyData {
  try {
    const raw = localStorage.getItem(treeKey(treeId));
    if (raw) return JSON.parse(raw) as FamilyData;
  } catch (err) {
    console.error("Failed to load family data, starting fresh", err);
  }
  return {};
}

function loadIndex(): TreeMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw) as TreeMeta[];

    // First run since multi-tree support: adopt the old single tree if present.
    const legacy = localStorage.getItem(LEGACY_V2_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const id = newId();
      const data = normalizeImport(JSON.parse(legacy));
      localStorage.setItem(treeKey(id), JSON.stringify(data));
      const index: TreeMeta[] = [{ id, name: "My Family", createdAt: new Date().toISOString() }];
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
      return index;
    }
  } catch (err) {
    console.error("Failed to load tree index, starting fresh", err);
  }
  return [];
}

export function countMembers(treeId: string): number {
  return Object.keys(load(treeId)).length;
}

/** Read another tree's people without subscribing — for cross-tree link pickers. */
export function peekTree(treeId: string): FamilyData {
  return load(treeId);
}

const sameLink = (a: CrossLink, b: CrossLink) => a.treeId === b.treeId && a.personId === b.personId;

/**
 * Update one person in a tree that is not currently mounted, straight in
 * localStorage. Only safe for trees other than the one useFamily is rendering.
 */
function updateUnmountedPerson(treeId: string, personId: string, fn: (p: Person) => Person) {
  try {
    const data = load(treeId);
    const person = data[personId];
    if (!person) return;
    localStorage.setItem(treeKey(treeId), JSON.stringify({ ...data, [personId]: fn(person) }));
  } catch (err) {
    console.error("Failed to update linked tree", err);
  }
}

export function useTreeIndex() {
  const [trees, setTrees] = useState<TreeMeta[]>(loadIndex);

  useEffect(() => {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(trees));
    } catch (err) {
      console.error("Failed to persist tree index", err);
    }
  }, [trees]);

  /** Returns the id of the newly created tree. */
  const createTree = useCallback((name: string, data: FamilyData = {}): string => {
    const id = newId();
    try {
      localStorage.setItem(treeKey(id), JSON.stringify(data));
    } catch (err) {
      console.error("Failed to persist new tree", err);
    }
    setTrees(prev => [...prev, { id, name, createdAt: new Date().toISOString() }]);
    return id;
  }, []);

  const renameTree = useCallback((id: string, name: string) => {
    setTrees(prev => prev.map(t => (t.id === id ? { ...t, name } : t)));
  }, []);

  const deleteTree = useCallback((id: string) => {
    localStorage.removeItem(treeKey(id));
    setTrees(prev => prev.filter(t => t.id !== id));
  }, []);

  return { trees, createTree, renameTree, deleteTree };
}

export type TreeIndexStore = ReturnType<typeof useTreeIndex>;

export function useFamily(treeId: string) {
  const [people, setPeople] = useState<FamilyData>(() => load(treeId));

  useEffect(() => {
    try {
      localStorage.setItem(treeKey(treeId), JSON.stringify(people));
    } catch (err) {
      console.error("Failed to persist family data", err);
    }
  }, [treeId, people]);

  /** Returns the id of the newly created person. */
  const addPerson = useCallback((input: PersonInput, rel: Relationship): string => {
    const id = newId();
    setPeople(prev => {
      const person: Person = { id, parents: [], spouseIds: [], ...input };
      const next = { ...prev, [id]: person };

      if (rel.kind === "child") {
        const links = [rel.parentId, rel.otherParentId]
          .filter((pid): pid is string => !!pid && !!next[pid])
          .map(pid => ({ id: pid, adopted: rel.adopted || undefined }));
        person.parents = links;
      } else if (rel.kind === "spouse") {
        const partner = next[rel.partnerId];
        if (partner) {
          person.spouseIds = [partner.id];
          next[partner.id] = { ...partner, spouseIds: [...partner.spouseIds, id] };
        }
      } else if (rel.kind === "parent") {
        const child = next[rel.childId];
        if (child && child.parents.length < 2) {
          next[child.id] = { ...child, parents: [...child.parents, { id }] };
          const existing = child.parents[0] && next[child.parents[0].id];
          if (rel.marryExisting && existing) {
            person.spouseIds = [existing.id];
            next[existing.id] = { ...existing, spouseIds: [...existing.spouseIds, id] };
          }
        }
      }
      return next;
    });
    return id;
  }, []);

  const updatePerson = useCallback((id: string, input: PersonInput) => {
    setPeople(prev => {
      const person = prev[id];
      if (!person) return prev;
      return { ...prev, [id]: { ...person, ...input } };
    });
  }, []);

  const deletePerson = useCallback((id: string) => {
    setPeople(prev => {
      // Drop reciprocal cross-links pointing back at the deleted person.
      // Removal is idempotent, so re-running the updater is harmless.
      const self: CrossLink = { treeId, personId: id };
      for (const link of prev[id]?.links ?? []) {
        updateUnmountedPerson(link.treeId, link.personId, p => ({
          ...p,
          links: (p.links ?? []).filter(l => !sameLink(l, self)),
        }));
      }
      const next: FamilyData = {};
      for (const p of Object.values(prev)) {
        if (p.id === id) continue;
        next[p.id] = {
          ...p,
          parents: p.parents.filter(link => link.id !== id),
          spouseIds: p.spouseIds.filter(sid => sid !== id),
        };
      }
      return next;
    });
  }, [treeId]);

  const linkSpouse = useCallback((aId: string, bId: string) => {
    setPeople(prev => {
      const a = prev[aId];
      const b = prev[bId];
      if (!a || !b || aId === bId || a.spouseIds.includes(bId)) return prev;
      return {
        ...prev,
        [aId]: { ...a, spouseIds: [...a.spouseIds, bId] },
        [bId]: { ...b, spouseIds: [...b.spouseIds, aId] },
      };
    });
  }, []);

  const unlinkSpouse = useCallback((aId: string, bId: string) => {
    setPeople(prev => {
      const a = prev[aId];
      const b = prev[bId];
      if (!a || !b) return prev;
      return {
        ...prev,
        [aId]: { ...a, spouseIds: a.spouseIds.filter(sid => sid !== bId) },
        [bId]: { ...b, spouseIds: b.spouseIds.filter(sid => sid !== aId) },
      };
    });
  }, []);

  const addParent = useCallback((childId: string, parentId: string) => {
    setPeople(prev => {
      const child = prev[childId];
      const parent = prev[parentId];
      if (!child || !parent || childId === parentId) return prev;
      if (child.parents.length >= 2 || child.parents.some(l => l.id === parentId)) return prev;
      // Refuse links that would make someone their own ancestor.
      if (descendantsOf(prev, childId).has(parentId)) return prev;
      return { ...prev, [childId]: { ...child, parents: [...child.parents, { id: parentId }] } };
    });
  }, []);

  const removeParent = useCallback((childId: string, parentId: string) => {
    setPeople(prev => {
      const child = prev[childId];
      if (!child) return prev;
      return { ...prev, [childId]: { ...child, parents: child.parents.filter(l => l.id !== parentId) } };
    });
  }, []);

  const setParentAdopted = useCallback((childId: string, parentId: string, adopted: boolean) => {
    setPeople(prev => {
      const child = prev[childId];
      if (!child) return prev;
      return {
        ...prev,
        [childId]: {
          ...child,
          parents: child.parents.map(l => (l.id === parentId ? { ...l, adopted: adopted || undefined } : l)),
        },
      };
    });
  }, []);

  /** Mark `personId` and a person in another tree as the same person, both ways. */
  const addCrossLink = useCallback((personId: string, link: CrossLink) => {
    if (link.treeId === treeId) return;
    setPeople(prev => {
      const person = prev[personId];
      if (!person || (person.links ?? []).some(l => sameLink(l, link))) return prev;
      return { ...prev, [personId]: { ...person, links: [...(person.links ?? []), link] } };
    });
    const self: CrossLink = { treeId, personId };
    updateUnmountedPerson(link.treeId, link.personId, p =>
      (p.links ?? []).some(l => sameLink(l, self)) ? p : { ...p, links: [...(p.links ?? []), self] },
    );
  }, [treeId]);

  const removeCrossLink = useCallback((personId: string, link: CrossLink) => {
    setPeople(prev => {
      const person = prev[personId];
      if (!person?.links) return prev;
      return { ...prev, [personId]: { ...person, links: person.links.filter(l => !sameLink(l, link)) } };
    });
    const self: CrossLink = { treeId, personId };
    updateUnmountedPerson(link.treeId, link.personId, p => ({
      ...p,
      links: (p.links ?? []).filter(l => !sameLink(l, self)),
    }));
  }, [treeId]);

  const replaceAll = useCallback((data: FamilyData) => setPeople(data), []);

  return {
    people,
    addPerson,
    updatePerson,
    deletePerson,
    linkSpouse,
    unlinkSpouse,
    addParent,
    removeParent,
    setParentAdopted,
    addCrossLink,
    removeCrossLink,
    replaceAll,
  };
}

export type FamilyStore = ReturnType<typeof useFamily>;
