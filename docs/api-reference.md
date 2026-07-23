# API Reference

All endpoints are Next.js App Router route handlers that delegate to server
handlers in `src/server/handlers/`. Auth is via Better Auth session cookies
(same-origin). Read this before adding or changing routes.

## Pages (not API)

See [architecture.md](./architecture.md) for the page routes (`/`, `/tree/[treeId]`,
`/tree/[treeId]/p/[personId]`, catch-all). Private UI lives in `_tree/` and
`_sidebar/` folders (excluded from routing).

## `/api/auth/*`

| | |
|---|---|
| File | `src/app/api/auth/[...all]/route.ts` |
| Methods | `GET`, `POST` |
| Handler | `handleAuth` — `src/server/auth.ts:59` |

Better Auth catch-all: sign-in, callback, session, and sign-out flows. See
[auth-and-acl.md](./auth-and-acl.md).

## `/api/sync`

| | |
|---|---|
| File | `src/app/api/sync/route.ts` |
| Handlers | `src/server/handlers/sync.ts` |
| Auth | Requires a session (`requireSession`, `:21`). |

### `GET /api/sync` — delta pull

Handler: `getSync` — `src/server/handlers/sync.ts:69`.

- Query: `since=<ISO timestamp>` (full pull when omitted/epoch).
- Returns `SyncPullResponse` (`src/sync/types.ts`):
  - `own.persons` / `own.trees` — the caller's records updated after `since`
    (tombstones included so deletes propagate).
  - `shared: SharedTreeWire[]` — every active shared tree, each with its members'
    person rows and the owner's email.
  - `serverTime` — current server timestamp for the next `since` cursor.
- Roles are stamped on the wires: `"owner"` for own records, the share `role`
  for shared trees. Helpers: `personToWire` (`:35`), `treeToWire` (`:50`).

### `POST /api/sync` — batched push

Handler: `postSync` — `src/server/handlers/sync.ts:130`.

Request: `SyncPushRequest` (`persons: PersonWire[]`, `trees: TreeWire[]`).
Response: `SyncPushResponse` — `{ applied: {persons, trees}, skipped: {persons, trees}, serverTime }`.

**Per-record ACL + last-write-wins:**

- **Persons**:
  - No existing row and not a delete → insert with `ownerId = <caller>` (the
    requester becomes the owner).
  - Otherwise require `canWrite(role)`; reject stale records
    (`wire.updatedAt <= existing.updatedAt`).
  - Tombstoning is only allowed by the person-row owner.
- **Trees**:
  - Only the requester creates new owned trees.
  - `canWrite(role)` required to modify.
  - LWW on `updatedAt`; delete only by `owner`.
  - **Editors may change `edges`, but only owners may rename** (`name`).

Skipped records (ACL-rejected or stale) are reported back; the client does not
reconcile them (best-effort push).

## `/api/trees/[treeId]/shares`

| | |
|---|---|
| File | `src/app/api/trees/[treeId]/shares/route.ts` |
| Methods | `GET` (`:9`), `POST` (`:14`), `DELETE` (`:19`) |
| Handlers | `src/server/handlers/shares.ts` |
| Auth | **Owner-only** — `requireOwner`, `src/server/handlers/shares.ts:15` (returns 401/403 otherwise). |

Next.js 15 async params: handlers receive `params: Promise<{ treeId }>`.

### `GET` — list shares

`listShares` — `src/server/handlers/shares.ts:25`. Returns `ShareRow[]`
(`{ email, userId, role, createdAt, pending }`) where `pending = userId === null`.

### `POST` — add/update a share

`addShare` — `src/server/handlers/shares.ts:50`. Body: `{ email, role }`.

- Validates email and role (`viewer` / `editor`).
- If a user with that email already exists, binds `userId` immediately.
- `onConflictDoUpdate` on `(treeId, email)` upserts the role and `userId`.

### `DELETE` — revoke a share

`removeShare` — `src/server/handlers/shares.ts:97`. Query: `?email=<email>`.
Deletes the share row.

## Wire types

All request/response shapes are defined in `src/sync/types.ts` (`PersonWire`,
`TreeWire`, `SharedTreeWire`, `SyncPullResponse`, `SyncPushRequest`,
`SyncPushResponse`). They mirror the domain types plus sync metadata
(`updatedAt`, `deletedAt`, `ownerId`, `role`, `ownerEmail`) — see
[domain-model.md](./domain-model.md).
