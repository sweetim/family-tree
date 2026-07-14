export type Gender = "male" | "female" | "other";

export interface ParentLink {
  id: string;
  adopted?: boolean;
}

/** The same person appearing in another tree (e.g. married into that family). */
export interface CrossLink {
  treeId: string;
  personId: string;
}

export interface Person {
  id: string;
  name: string;
  /** ISO date string, e.g. "1985-04-12" */
  dob?: string;
  /** Date of death — set when the person is deceased */
  dod?: string;
  gender?: Gender;
  location?: string;
  /** Compressed data-URL of the uploaded photo */
  photo?: string;
  /** 0..2 parents, each link can be marked as adoptive */
  parents: ParentLink[];
  /** Supports multiple marriages */
  spouseIds: string[];
  /** This person's cards in other trees — kept reciprocal by the store */
  links?: CrossLink[];
}

export type FamilyData = Record<string, Person>;

export type Relationship =
  | { kind: "root" }
  | { kind: "child"; parentId: string; otherParentId?: string; adopted?: boolean }
  | { kind: "spouse"; partnerId: string }
  | { kind: "parent"; childId: string; marryExisting?: boolean };

export interface PersonInput {
  name: string;
  dob?: string;
  dod?: string;
  gender?: Gender;
  location?: string;
  photo?: string;
}

export function childrenOf(people: FamilyData, id: string): Person[] {
  return Object.values(people).filter(p => p.parents.some(link => link.id === id));
}

export function descendantsOf(people: FamilyData, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    for (const child of childrenOf(people, stack.pop()!)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return seen;
}

/**
 * The subset of the family seen from one person's perspective: their blood
 * relatives (ancestors, plus every descendant of those ancestors — siblings,
 * cousins, children…) and the direct spouses of all of them. Married-in
 * spouses are shown, but their own families are not.
 */
export function focusFamily(people: FamilyData, focusId: string): FamilyData {
  if (!people[focusId]) return people;
  const blood = new Set<string>([focusId, ...ancestorsOf(people, focusId)]);
  for (const id of [...blood]) {
    for (const d of descendantsOf(people, id)) blood.add(d);
  }
  const included = new Set(blood);
  for (const id of blood) {
    for (const sid of people[id]?.spouseIds ?? []) {
      if (people[sid]) included.add(sid);
    }
  }
  return Object.fromEntries([...included].map(id => [id, people[id]!]));
}

export function ancestorsOf(people: FamilyData, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    for (const link of people[stack.pop()!]?.parents ?? []) {
      if (people[link.id] && !seen.has(link.id)) {
        seen.add(link.id);
        stack.push(link.id);
      }
    }
  }
  return seen;
}
