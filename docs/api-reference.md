# API Reference

Next.js App Router handlers delegate to `src/server/handlers/`. Authentication
uses same-origin Better Auth session cookies.

## `/api/auth/*`

`GET` and `POST` are handled by Better Auth through
`src/app/api/auth/[...all]/route.ts`. See
[auth-and-acl.md](./auth-and-acl.md).

## `/api/sync`

Both methods require a session. Wire types are defined in
`src/sync/types.ts`.

### Normalized record set

Every own-data pull and push has exactly these arrays:

- `persons`
- `trees`
- `treeMembers`
- `unions`
- `unionEvents`
- `treeUnions`
- `parentChildRelationships`
- `treeParentChildRelationships`

Active records carry their entity fields plus timestamps. Deleted records are
tombstones keyed by entity id or the association's two ids.

### `GET /api/sync`

Query: optional `since=<ISO timestamp>`; omission means epoch. Invalid values
or values more than five minutes in the future return `400`.

Response: `SyncPullResponse` with `own`, `shared`, and `serverTime`.

- `own` contains updated owned tree/person records and normalized records for
  active owned trees. Active dependencies needed for projection are repeated;
  changed tombstones remain deltas.
- Each `shared` item contains the tree, role, owner email, and a complete active
  snapshot of all seven non-tree collections for that tree. It intentionally
  excludes former dependencies and tombstones.
- `serverTime` is the server cutoff used for the response. Own queries exclude
  records newer than that cutoff so a later cursor cannot skip them.

### `POST /api/sync`

Request: `SyncPushRequest`, the exact eight-array record set above.

Response:

```ts
{
  applied: SyncAppliedIds
  skipped: SyncAppliedIds
  serverTime: string
}
```

Payload validation requires exact object keys, valid ids/types/dates,
reasonable timestamps, canonical union ordering, and unique keys within each
collection. Invalid payloads return `400`. Valid but stale, unauthorized, or
constraint-violating records are reported in `skipped`.

All successful inserts, updates, revivals, and tombstones set `updated_at` (and
server-created deletion time) from PostgreSQL `CURRENT_TIMESTAMP`. Client
`updatedAt` is a conditional last-write-wins token and must be newer than the
stored timestamp; it is never persisted as the authoritative update clock.
Client timestamps more than five minutes in the future are rejected.

#### Record behavior

| Collection | Rules |
|---|---|
| `persons` | New rows are owned by the caller. Accessible editors/owners may update identity. Only the person-row owner may delete, which atomically tombstones the person and all memberships, unions/events, parent facts, and tree associations involving it. |
| `trees` | New rows are owned by the caller. Only the tree owner may rename or delete an existing tree. |
| `treeMembers` | Requires a writable tree and active person. New/revived membership also requires write access to the person. A member cannot be removed while an active relationship in that tree still references them. |
| `unions` | Creation requires active endpoints together in a writable tree. Endpoints are distinct, canonical, and immutable. Existing facts can be touched through a writable associated tree or ownership of both people. Clients cannot tombstone union facts. |
| `unionEvents` | Requires a writable union, valid event type, and optional exact ISO date. `unionId` is immutable. Clients cannot tombstone events. |
| `treeUnions` | Requires a writable tree, active union, and both endpoints as active tree members. Deletion detaches only that tree. |
| `parentChildRelationships` | Creation requires both active endpoints together in a writable tree. Endpoints are immutable; type may change. Self-links, a third active global parent, and global ancestry cycles are rejected. Clients cannot tombstone these facts. |
| `treeParentChildRelationships` | Requires a writable tree, active fact, and both endpoints as active tree members. Deletion detaches only that tree. |

New global facts that fail to gain any requested tree association are removed
and reported as skipped, avoiding inaccessible orphan facts.

## `/api/trees/[treeId]`

`DELETE` requires the tree owner. It atomically tombstones the tree and its
memberships, union associations, and parent/child associations using the server
clock. The client removes the tree only after a successful response.

Unauthenticated requests return `401`, invalid ids return `400`, and missing or
non-owned trees return `404`.

## `/api/trees/[treeId]/shares`

All methods are tree-owner-only. Unauthenticated requests return `401`; other
roles return `403`.

| Method | Input | Result |
|---|---|---|
| `GET` | none | `{ shares }`, where each row has `email`, nullable `userId`, role, creation time, and `pending`. |
| `POST` | `{ email, role: "viewer" | "editor" }` | Adds the share or updates its role. Existing users bind immediately; unknown users remain pending. |
| `DELETE` | `?email=<email>` | Revokes that email's share. |

## Pages

Page routes are `/`, `/tree/[treeId]`, and
`/tree/[treeId]/p/[personId]`. See [architecture.md](./architecture.md).
