# Architecture

The app separates canonical family facts from the trees that display them.

## Data model

Person identities, unions and their event history, and parent/child facts are
shared records. Tree membership and tree-to-fact associations select which of
those records appear in each tree. The same person or relationship can
therefore appear in multiple trees without duplication.

Edits to identity, marriage date, and adoption type update canonical facts and
propagate globally. Spouse unlink, parent removal, and remove-from-tree detach
only one tree association. Union history can model divorce and other events,
but the Core UI currently exposes marriage and its date only.

## Layers

```text
React UI (App Router pages and components)
        | hooks and projected FamilyData
Client store (normalized in-memory maps)
        | full pull on account load; serialized pushes on mutation
API routes (thin wrappers)
        |
Server handler (route adapter)
        |
Sync pull/push use cases (validation, ACL, reconciliation)
        |
Set-based query and wire-mapping modules
        |
Drizzle ORM -> Neon Postgres normalized tables
```

The client store is the immediate source for rendering. The server is the
durable authority. Every entity and association reconciles independently by
timestamp; tombstone clocks prevent delayed resurrection. Skipped pushes and
account changes trigger an authoritative full rebuild.

There is no local persistence for pending edits and no polling, websocket, or
background refresh.

## Routing

Pages are client components because data is loaded into the runtime store
rather than rendered through SSR.

| Route | Purpose |
|---|---|
| `/` | Tree index and account entry. |
| `/tree/[treeId]` | Tree canvas and sidebar. |
| `/tree/[treeId]/p/[personId]` | Same tree with a person opened in the sidebar; used for cross-tree jumps. |
| catch-all | Redirects to `/`. |

Private `_tree/` and `_sidebar/` folders organize UI without creating routes.
`Providers` waits for client mount, supplies toast/confirm contexts, and runs
the account bootstrap. On account change it resets state, fetches an epoch
`/api/sync` pull, applies the complete own data and active shared snapshots, and
marks the store hydrated.

## API surface

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/auth/*` | GET, POST | Better Auth flows. |
| `/api/sync` | GET, POST | Normalized pull and batched push. |
| `/api/trees/[treeId]` | DELETE | Owner-only, server-authoritative tree deletion. |
| `/api/trees/[treeId]/shares` | GET, POST, DELETE | Owner-only share management. |

The sync protocol transports exactly `persons`, `trees`, `treeMembers`,
`unions`, `unionEvents`, `treeUnions`, `parentChildRelationships`, and
`treeParentChildRelationships`. Shared trees are returned as authoritative
active snapshots. See [state-and-sync.md](./state-and-sync.md).

## Rendering pipeline

```text
GlobalState normalized maps
    -> projectTree(persons, relationships, treeId)
    -> optional focusFamily(people, personId)
    -> buildFlow(people, settings)
    -> React Flow with PersonNode and UnionNode
```

`projectTree` is the persistence/UI seam. It derives the existing `FamilyData`
shape (`parents`, `spouseIds`, `marriageDates`) from normalized records, so the
layout and sidebar remain independent of storage.

The layout uses a custom genealogy algorithm rather than a generic layered
layout so partners remain adjacent and siblings retain birth order. See
[layout.md](./layout.md).

## Key decisions

- Shared facts have stable, immutable relationship endpoints; replacement
  facts are created when a person merge changes an endpoint.
- Tree association removal is not global fact deletion.
- Parent constraints are global: no self-parent, at most two active parents,
  and no active ancestry cycle.
- ACL is evaluated per normalized record using tree role and person ownership.
- Pull queries are batched by normalized collection, so database round trips do
  not increase with the number of accessible trees. Pushes preload immutable
  ownership, while shared roles are rechecked so revocation takes effect.
- Client timestamps are concurrency tokens; successful writes receive server
  `CURRENT_TIMESTAMP` values.
- Photos are cropped/downscaled and compressed in the browser, uploaded through
  bounded sync commands, and stored as Vercel Blob URLs. Pull DTOs expose only
  photo presence; authenticated reads use `/api/person-photo/[personId]`.

## Folder map

| Path | Contents |
|---|---|
| `src/app/` | Pages, providers, API routes, tree canvas, and sidebar. |
| `src/components/` | Reusable UI components. |
| `src/db/` | Drizzle schema and Neon client. |
| `src/lib/` | Layout, image, auth-client, tree-action, and view-setting helpers. |
| `src/server/` | Auth, ACL, request limits, handlers, and sync use cases. |
| `src/sync/` | Normalized wire types. |
| `src/types.ts` | Domain records, projection, and traversal. |
| `src/store.ts` | Normalized client state, mutations, and sync. |
