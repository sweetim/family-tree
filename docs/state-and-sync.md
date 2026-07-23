# Client Store & Sync

How client state is held, mutated, and reconciled with the server. Everything is
in `src/store.ts` unless noted. Read this before touching state, mutations, or
the sync protocol.

## Store design

The store is **not Zustand** — it is a hand-rolled external store bound to React
via `useSyncExternalStore`. There are three module-level singletons: the current
`state`, a `hydrated` boolean, and a `Set` of listeners.

### State shape

| Type | Location | Notes |
|---|---|---|
| `ShareRole` | `src/store.ts:16` | `"viewer" \| "editor"`. |
| `LocalRole` | `src/store.ts:17` | `"owner" \| ShareRole` — the current user's role on a tree. |
| `TreeMeta` | `src/store.ts:19` | Tree list entry: `id, name, createdAt, updatedAt?, ownerId?, ownerEmail?, role?`. |
| `GlobalState` | `src/store.ts:34` | `persons: Record<id, PersonIdentity>` (global identities) + `trees: Record<treeId, TreeEdges>` (per-tree edges) + `index: TreeMeta[]`. |

The split mirrors the DB: `persons` are global identities, `trees` hold edges,
and `index` is the tree list including **the current user's role on each tree**.

### Core plumbing

- `getSnapshot()` — `src/store.ts:198`. Returns the current `state` to React.
- `subscribe(listener)` — `src/store.ts:409`. Registers a listener; returns unsubscribe.
- `useHydrated()` — `src/store.ts:437`. React hook over the `hydrated` flag.
- `setHydrated(value)` — `src/store.ts:420`. Set by the bootstrap pull.
- `resetStore()` — `src/store.ts:430`. Wipes state + dirty maps. Called on sign-out.

## The mutation pipeline

Every mutation flows through one internal function:

- `update(updater, opts?)` — `src/store.ts:184`. Runs `updater(prev)` to produce
  a new state. Unless `opts.remote` is set, it then calls `stampAndEnqueue`.

### Dirty tracking

- `stampAndEnqueue(prev, next)` — `src/store.ts:121`. Diffs `prev` vs `next` by
  **reference equality**, stamps a fresh `updatedAt` on every changed/added
  record, and enqueues an `upsert` or `delete` into the module-level dirty maps.
- `DirtyMap` / `DirtyAction` — `src/store.ts:109` / `:108`.
- `snapshotDirty()` — `src/store.ts:202`. Test seam returning the current dirty maps.
- `clearDirty(ids)` — `src/store.ts:209`. Clears shipped ids after a successful push.

**Why re-stamp every local edit?** Re-stamping guarantees local edits beat the
server's last-write-wins comparison even when a mutator left a stale
`updatedAt`. This is regression-tested in `src/store.test.ts`.

### Push to server

- `pushDirty()` — `src/store.ts:222`. Fire-and-forget `POST /api/sync` with the
  dirty records serialized to wire types. On `res.ok` it clears the shipped ids;
  on failure the ids stay dirty (in memory only — there is no local persistence).

## Remote merge

- `applyRemote(remote)` — `src/store.ts:303`. Entry point for server data (used by
  the bootstrap pull). It runs as a **remote** update, so it does **not** enqueue
  dirty ids (preventing echo loops). Merges persons, tree edges, and `index`
  using **last-write-wins** by `updatedAt`; tombstones (`deletedAt`) delete the
  local record. Preserves existing `ownerEmail`/`role` when the wire omits them.

## Edge helpers and cross-tree propagation

These pure helpers manipulate `TreeEdges` and are used by mutations and merges:

- `cloneTree`, `addMember`, `pairHas`, `addSpouseEdge`, `removeSpouseEdge`,
  `addParentEdge`, `removeParentEdge` — `src/store.ts:443`–`491`.
- `rewriteEdges(e, keep, drop)` — `src/store.ts:494`. Remaps a dropped id onto the
  kept id across members/spouses/parents, dedupes pairs, drops self-links, caps
  parents at 2. Used by `mergePersons`.
- `propagateSurvivor(trees, keepId)` — `src/store.ts:536`. After a merge, mirrors
  the survivor's relatives (spouses/parents/children) into every tree they belong to.
- `treesWithMember` — `src/store.ts:573`; `treesContainingAll` — `src/store.ts:586`.
- `makeDraft(prev)` — `src/store.ts:601`. Produces a draft that clones each touched
  tree at most once (minimal new object refs).

### Cross-tree membership rules

Mutations deliberately propagate membership across trees (see
[domain-model.md](./domain-model.md)):

- Adding a **spouse** adds them to every tree their partner is in.
- Adding a **child** adds them to every tree containing *all* of the child's parents.
- A new **parent** can optionally marry the existing other parent.

## Import / export helpers

- `normalizeImport(data)` — `src/store.ts:87`. Normalizes imported JSON into
  `FamilyData` and auto-migrates legacy v1 records into the current edges shape.
- `seedData()` — `src/store.ts:630`. Returns the built-in "Sample Family" seed
  (`TreeSeed`, defined at `src/store.ts:625`).

## React hooks

### `useTreeIndex()` — `src/store.ts:687`

Returns `{ trees, createTree, renameTree, deleteTree }`:

- `createTree(name, seed?)` — `:690`. Mints a `crypto.randomUUID()`; optionally
  seeds identities + edges.
- `renameTree(id, name)` — `:704`.
- `deleteTree(id)` — `:711`.

Helpers: `countMembers(treeId)` (`:724`), `useMemberTrees(personId)` (`:729` —
the "also appears in" badges), `useMembersOf(treeId)` (`:739` — cross-tree
spouse picker).

### `useFamily(treeId)` — `src/store.ts:750`

The workhorse. Returns projected `people` (via `projectTree`), `readOnly`
(`meta.role === "viewer"`), and all mutating actions:

| Action | Location | Purpose |
|---|---|---|
| `addPerson(input, rel)` | `:761` | Add identity + edges; propagates across trees (see above). |
| `updatePerson(id, input)` | `:819` | Edit identity (global; affects all trees). |
| `deletePerson(id)` | `:827` | Remove person + scrub all edges across all trees. |
| `mergePersons(keepId, dropId)` | `:852` | Merge two people into one (uses `rewriteEdges` + `propagateSurvivor`). |
| `linkSpouse(aId, bId)` | `:877` | Marry two existing people. |
| `unlinkSpouse(aId, bId)` | `:892` | Divorce. |
| `addParent(childId, ...)` | `:903` | Add a parent link; **refuses to create a cycle** (a descendant cannot become a parent). |
| `removeParent(childId, parentId)` | `:935` | Remove a parent link. |
| `setParentAdopted(childId, parentId, adopted)` | `:948` | Toggle adoptive flag on a parent link. |
| `linkAcrossTrees(personId, otherTreeId, otherPersonId)` | `:969` | Marry across trees; each becomes a member of the other's tree. |
| `removeFromTree(personId, treeId)` | `:999` | Drop membership in one tree only. |
| `replaceAll(data)` | `:1028` | Rebuild this tree's edges from `FamilyData` (used by Import). |

Because the store is global, editing a person in one tree re-renders every tree
they belong to.

## Sync protocol summary

There is **no polling, websockets, or background refresh**.

1. **Load** (`src/app/providers.tsx:17`): on session, `GET /api/sync?since=<epoch>`
   → `applyRemote` own data + each shared tree → `setHydrated(true)`.
2. **Mutate** (any `useFamily`/`useTreeIndex` action) → `update` →
   `stampAndEnqueue` → `pushDirty` POSTs the batched diff; clears dirty on success.
3. **Reconcile**: LWW by ISO `updatedAt` on both client (`applyRemote`) and server
   (`postSync`); tombstones delete. Remote updates bypass the dirty queue.

Wire types live in `src/sync/types.ts`; server behavior in
[src/server/handlers/sync.ts](../src/server/handlers/sync.ts) is documented in
[api-reference.md](./api-reference.md).

## Client-only view preferences

Display settings (e.g. minimap on/off) live in a separate store, **never
synced**, persisted to `localStorage`:

- `src/lib/view-settings.ts` — `ViewSettings` (`:8`), `updateViewSettings` (`:36`),
  `useViewSettings()` (`:46`).
