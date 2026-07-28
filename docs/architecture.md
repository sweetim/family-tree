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
and the UI exposes marriage, divorce, and reconciliation.

## Layers

```text
React UI (App Router pages and components)
        | hooks and projected FamilyData
Client store (normalized maps + IndexedDB outbox)
        | metadata manifest, lazy snapshots, cursor changes, mutations
API routes (thin wrappers)
        |
Server handler (route adapter)
        |
V2 query/mutation use cases (validation, ACL, reconciliation)
        |
Set-based query and wire-mapping modules
        |
Drizzle ORM -> Neon Postgres normalized tables
```

The client store is the immediate source for rendering and PostgreSQL is the
durable authority. Server revisions provide optimistic concurrency. Pending
intent, retry IDs, and cursors persist in IndexedDB. Tree-scoped cursor polling,
focus, and online refreshes propagate collaborator changes.

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
the account bootstrap. On account change it restores the durable outbox and
fetches a metadata-only tree manifest. Selected trees load on demand.

## API surface

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/auth/*` | GET, POST | Better Auth flows. |
| `/api/trees` | GET | Paginated metadata/access manifest. |
| `/api/trees/[treeId]/snapshot` | GET | One selected tree snapshot. |
| `/api/trees/[treeId]/graph` | GET | Bounded graph around a person. |
| `/api/changes` | GET | Paginated tree-scoped deltas. |
| `/api/mutations` | POST | Atomic, idempotent mutations. |
| `/api/people/search` | GET | Bounded accessible-person search. |
| `/api/trees/[treeId]/shares` | GET, POST, DELETE | Owner-only share management. |
| `/api/person-photo/[personId]` | GET | Authorized no-store image proxy. |

The normalized protocol transports exactly `persons`, `trees`, `treeMembers`,
`unions`, `unionEvents`, `treeUnions`, `parentChildRelationships`, and
`treeParentChildRelationships`. See [state-and-sync.md](./state-and-sync.md).

## Rendering pipeline

```text
GlobalState normalized maps
    -> projectTree(persons, relationships, treeId)
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
- Normal reads are metadata-only, selected-tree, bounded graph, or change-page
  queries. They do not fetch every accessible tree.
- Mutations use server revisions, durable IDs, and one interactive transaction.
  Client timestamps are metadata only.
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
| `src/store/` | Normalized client state, mutations, IndexedDB, and sync. |
