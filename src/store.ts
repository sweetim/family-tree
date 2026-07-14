import { useCallback, useEffect, useState } from "react";
import { descendantsOf, type FamilyData, type Person, type PersonInput, type Relationship } from "./types";

const STORAGE_KEY = "family-tree-v2";
const LEGACY_KEY = "family-tree-v1";

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

function seedData(): FamilyData {
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

function load(): FamilyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as FamilyData;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateLegacy(JSON.parse(legacy));
  } catch (err) {
    console.error("Failed to load family data, starting fresh", err);
  }
  return seedData();
}

export function useFamily() {
  const [people, setPeople] = useState<FamilyData>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
    } catch (err) {
      console.error("Failed to persist family data", err);
    }
  }, [people]);

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
  }, []);

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
    replaceAll,
  };
}

export type FamilyStore = ReturnType<typeof useFamily>;
