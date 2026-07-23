# Domain Model

How people, trees, and relationships are represented. All types live in
`src/types.ts`. Read this before changing how family data is shaped.

## Core idea: identity is global, edges are per-tree

- A person's **identity** (`PersonIdentity`) is stored once and shared across
  every tree the person belongs to. Editing a name, photo, or date updates it
  everywhere automatically.
- A tree's **edges** (`TreeEdges`) describe only that tree: who is a member,
  who is married to whom, and who is whose parent.
- At render time, the two are merged by `projectTree` into a per-tree view
  (`FamilyData`) that the layout and sidebar consume.

This split means **linking a person across two trees is just adding the same
person id to two trees' member lists** — there is no separate "link" entity.

## Types and their locations

| Type | Location | Notes |
|---|---|---|
| `Gender` | `src/types.ts:1` | `"male" \| "female" \| "other"`. |
| `ParentLink` | `src/types.ts:3` | `{ id; adopted? }` — a parent reference that may be marked adoptive. |
| `PersonIdentity` | `src/types.ts:13` | Global identity: `id, name, dob?, dod?, gender?, location?, photo?, updatedAt?`. `photo` is a compressed data URL. `updatedAt` is set only by the sync seam, never by mutators. |
| `Person` | `src/types.ts:33` | `PersonIdentity` plus this tree's edges: `parents: ParentLink[]` (0–2) and `spouseIds: string[]`. This is what layout/sidebar use. |
| `FamilyData` | `src/types.ts:40` | `Record<string, Person>` — the projected view for a single tree. |
| `TreeEdges` | `src/types.ts:49` | `members: string[]`, `spouses: [string,string][]`, `parents: Record<string, ParentLink[]>`. |
| `Relationship` | `src/types.ts:85` | Discriminated union for adding a member: `root`, `child`, `spouse`, `parent`. See below. |
| `PersonInput` | `src/types.ts:96` | Writable subset of a person (no `id`/`updatedAt`). |

### The `Relationship` union (`src/types.ts:85`)

Used by `addPerson` to place a new member relative to existing people:

- `{ kind: "root" }` — standalone first member.
- `{ kind: "child"; parentId; otherParentId?; adopted? }` — child of one or two
  existing parents.
- `{ kind: "spouse"; partnerId }` — spouse of an existing person.
- `{ kind: "parent"; childId; marryExisting? }` — add a (new) parent of an
  existing child, optionally marrying the other existing parent.

## Functions

### Projection seam

- `emptyEdges()` — `src/types.ts:55`. Returns `{ members: [], spouses: [], parents: {} }`.
- `projectTree(identities, edges)` — `src/types.ts:60`. **The projection seam.**
  Builds a `FamilyData` by merging global identities with a tree's edges:
  derives each person's `spouseIds` from the symmetric `spouses` pairs, and
  `parents` from `edges.parents[id]`. Members whose identity is missing are
  dropped. This is what layout and the sidebar consume.

### Traversal (pure, operate on `FamilyData`)

- `childrenOf(people, id)` — `src/types.ts:105`. Direct children of `id`.
- `descendantsOf(people, id)` — `src/types.ts:111`. Iterative DFS returning a
  `Set<string>` of all descendants.
- `ancestorsOf(people, id)` — `src/types.ts:153`. Iterative DFS returning a
  `Set<string>` of all ancestors.
- `focusFamily(people, focusId)` — `src/types.ts:133`. Builds the "focus view":
  the focus person + all ancestors + every descendant of those ancestors
  (siblings, cousins, children), plus the direct spouses of anyone included.
  Married-in spouses appear, but their own families do not.

## Invariants worth remembering

- A person has **0–2 parents** per tree (capped in edge helpers, see
  `src/store.ts` around `addParentEdge`).
- `spouses` is a list of unordered pairs; spouse links are symmetric and are
  derived per-person at projection time.
- Membership in multiple trees is normal and expected — it is how cross-family
  linking works.

## Sync wire types

The on-the-wire shapes at the DB/client boundary live in `src/sync/types.ts`
(`PersonWire`, `TreeWire`, `SharedTreeWire`, `SyncPullResponse`,
`SyncPushRequest`, `SyncPushResponse`). They mirror the domain types but add
sync metadata (`updatedAt`, `deletedAt`, `ownerId`, `role`, `ownerEmail`).
See [state-and-sync.md](./state-and-sync.md) and [database.md](./database.md).
