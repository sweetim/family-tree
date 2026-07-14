export type Gender = "male" | "female" | "other";

export interface ParentLink {
  id: string;
  adopted?: boolean;
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
