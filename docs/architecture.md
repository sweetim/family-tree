# Architecture

High-level view of how the Family Tree app is built and how data flows through it.
For the data shapes, see [domain-model.md](./domain-model.md); for state/sync
internals, see [state-and-sync.md](./state-and-sync.md).

## Mental model in one paragraph

The app **separates identity from relationships**. A person's identity (name,
photo, dates) is stored **once globally**. Relationship edges (who is in which
tree, who is married to whom, who is whose parent) are stored **per tree**. A
single global person can be a member of many trees, which makes "linking a
person across two families" simply "add the same person id to two trees' member
lists". When a tree is rendered, global identities and that tree's edges are
merged into a per-tree view (`projectTree`) that the layout and sidebar consume.

## Layered structure

```
React UI (app routes, components)
        |  uses hooks
Client store (src/store.ts)  —— global identities + per-tree edges (in memory)
        |  read via useSyncExternalStore; mutations enqueue dirty records
        |  push on mutate / pull on load
API routes (src/app/api/**)  —— thin wrappers
        |
Server handlers (src/server/handlers/**)  —— business logic + ACL
        |
Drizzle ORM (src/db/**)  —— Neon Postgres
```

- The **client store** is the single source of truth for what the UI renders. It
  holds global `persons` and per-tree `trees` (edges) in memory.
- The **server** is the durable source of truth. The client pushes local edits
  and pulls server state on load. The two are reconciled with
  **last-write-wins** on an `updatedAt` timestamp and tombstones for deletes.

## Routing (App Router)

All routes are client components (`"use client"`) because data is fetched at
runtime from the store, not via SSR.

| Route | File | Role |
|---|---|---|
| `/` (layout) | `src/app/layout.tsx` | Root HTML, Inter font, wraps children in `<Providers>`. |
| `/` | `src/app/page.tsx` | Home page. Reads `useTreeIndex()` and renders `<HomePage>`. |
| `/tree/[treeId]` | `src/app/tree/[treeId]/page.tsx:8` | Renders `<TreeView>` for the tree, or a "not available / sign in" state. |
| `/tree/[treeId]/p/[personId]` | `src/app/tree/[treeId]/p/[personId]/page.tsx:7` | Same `<TreeView>` but opens a specific person in the sidebar on arrival. Used for cross-tree person jumps. |
| catch-all | `src/app/not-found.tsx` | Redirects to `/`. |

Private UI folders are prefixed with `_` so Next.js excludes them from routing:
`_tree/` (the canvas) and `_sidebar/` (the editor panels).

### Providers and bootstrap

`src/app/providers.tsx`:

- `Providers` (`:66`) renders `null` until mounted on the client, then wraps the
  app in `ToastProvider` → `ConfirmProvider`. This client-only gate avoids
  hydration mismatches everywhere.
- `ServerDataBootstrap` (`:17`) watches the session. On sign-in it does a
  one-shot full pull (`GET /api/sync?since=<epoch>`) and feeds the result to
  `applyRemote` for own data and each shared tree, then calls `setHydrated(true)`.
  On sign-out it calls `resetStore()` so the previous user's data is wiped.

## API surface

Three API areas, each a thin wrapper over a server handler. Details in
[api-reference.md](./api-reference.md).

| Endpoint | File | Methods |
|---|---|---|
| `/api/auth/*` | `src/app/api/auth/[...all]/route.ts` | GET, POST |
| `/api/sync` | `src/app/api/sync/route.ts` | GET (pull), POST (push) |
| `/api/trees/[treeId]/shares` | `src/app/api/trees/[treeId]/shares/route.ts` | GET, POST, DELETE |

## Sync model (summary)

There is **no polling or websockets**. The protocol is:

1. **Pull on load** — `ServerDataBootstrap` fetches everything once per session.
2. **Push on mutate** — every local edit is optimistically applied, then the
   changed records are fire-and-forget POSTed to `/api/sync`.
3. **Reconcile** — both sides compare `updatedAt` strings (last-write-wins) and
   use `deletedAt` tombstones to propagate deletes.

See [state-and-sync.md](./state-and-sync.md) for the full pipeline.

## Rendering pipeline (summary)

```
GlobalState (persons + trees[treeId].edges)
   -> projectTree(identities, edges)        src/types.ts:60   -> FamilyData
   -> (optional) focusFamily(people, id)    src/types.ts:133  -> focused subset
   -> buildFlow(people, ...)                src/lib/layout.ts:240 -> React Flow nodes+edges
   -> <ReactFlow> with PersonNode / UnionNode
```

The layout is a **custom recursive genealogy algorithm**, not dagre, because
generic layered layout breaks two family-chart invariants (partners must sit
side-by-side; siblings must stay in birth order). See [layout.md](./layout.md).

## Key design decisions to keep in mind

- **Identity is global, edges are per-tree.** Editing a person's name/photo
  updates every tree they appear in automatically.
- **Cross-tree linking = shared membership.** There is no separate "link"
  entity; a person is simply a member of multiple trees.
- **Optimistic, in-memory client store.** There is no local persistence; dirty
  (un-pushed) edits are kept only in memory.
- **Per-record ACL.** Permission is checked per record (person or tree), not
  per request, using the highest role across all trees a person belongs to.
- **Photos never touch the server.** Images are cropped/downscaled to a 256px
  JPEG data URL entirely in the browser, then stored as a text column.

## Folder map

| Path | Contents |
|---|---|
| `src/app/` | Pages, layout, providers, API routes, and the private `_tree` / `_sidebar` UI. |
| `src/components/` | Reusable UI: `PersonNode`, `UnionNode`, `HomePage`, `ShareDialog`, `AccountMenu`, `AvatarCropper`, `Toast`, `Confirm`, `Section`. |
| `src/db/` | `schema.ts` (Drizzle tables) and `index.ts` (Neon client). |
| `src/lib/` | Pure/client helpers: `layout.ts`, `image.ts`, `auth-client.ts`, `tree-actions.ts`, `view-settings.ts`. |
| `src/server/` | Server-only: `auth.ts`, `acl.ts`, and `handlers/` (`sync.ts`, `shares.ts`). |
| `src/sync/` | Wire types for the sync protocol (`types.ts`). |
| `src/types.ts` | Core domain model. |
| `src/store.ts` | Client store: state, hooks, mutations, sync push/pull. |
