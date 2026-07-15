export type Gender = "male" | "female" | "other";

export interface ParentLink {
  id: string;
  adopted?: boolean;
}

/**
 * A person's identity — stored once globally so a name/photo/DOB edit shows
 * up in every tree the person belongs to. Relationship edges live per-tree
 * (see {@link TreeEdges}) and are merged in at projection time.
 */
export interface PersonIdentity {
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
}

/**
 * The full person as a single tree sees it: identity plus that tree's
 * relationship edges. This is what layout and the sidebar consume. It is a
 * projection of {@link PersonIdentity} + {@link TreeEdges}.
 */
export interface Person extends PersonIdentity {
  /** 0..2 parents in this tree, each link can be marked as adoptive */
  parents: ParentLink[];
  /** Supports multiple marriages, in this tree */
  spouseIds: string[];
}

export type FamilyData = Record<string, Person>;

/**
 * A tree's relationship edges — who appears in it and how they relate.
 * `members` is the list of person IDs rendered in the tree; `spouses` and
 * `parents` are the marriage / parent-child edges for that tree only. Because
 * the same global person can be a member of several trees, linking two people
 * across families is just adding each to the other's tree.
 */
export interface TreeEdges {
  members: string[];
  spouses: [string, string][];
  parents: Record<string, ParentLink[]>;
}

export function emptyEdges(): TreeEdges {
  return { members: [], spouses: [], parents: {} };
}

/** Derive the per-tree {@link FamilyData} view from global identities + edges. */
export function projectTree(
  identities: Record<string, PersonIdentity>,
  edges: TreeEdges,
): FamilyData {
  const spousesOf = (id: string): string[] => {
    const out: string[] = [];
    for (const [a, b] of edges.spouses) {
      if (a === id) out.push(b);
      else if (b === id) out.push(a);
    }
    return out;
  };
  const family: FamilyData = {};
  for (const id of edges.members) {
    const ident = identities[id];
    if (!ident) continue;
    family[id] = { ...ident, parents: edges.parents[id] ?? [], spouseIds: spousesOf(id) };
  }
  return family;
}

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
