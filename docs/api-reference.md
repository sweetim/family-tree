# API Reference

Next.js App Router handlers use same-origin Better Auth session cookies. The API
separates bounded queries from idempotent mutations. Wire types are defined in
`src/sync/types.ts`.

## Authentication

`GET` and `POST /api/auth/*` are handled by Better Auth. Every family-data
endpoint requires a session and returns `401` when unauthenticated.

## Tree manifest

`GET /api/trees?cursor=<opaque>&limit=<1-100>` returns accessible tree
metadata, role, member count, row revision, and sync version. It never loads
people or relationships. Results use stable keyset pagination.

## Tree reads

`GET /api/trees/[treeId]/snapshot` returns one selected tree and its active
normalized graph. It also returns an opaque change cursor pinned to the tree's
current sync version. Other accessible trees are not included.

`GET /api/trees/[treeId]/graph?focusPersonId=<id>&radius=<0-6>` returns at
most 300 people in a relationship neighborhood around one member. The response
sets `partial: true` and identifies boundary people. Person deep links use this
bounded query; the main tree canvas uses the selected-tree snapshot.

`GET /api/people/search?query=<text>` searches accessible identities without
loading their trees and returns at most eight results.

## Changes

`GET /api/changes?treeId=<id>&cursor=<opaque>&limit=<1-100>` returns ordered
normalized change batches after the supplied cursor. The work and payload scale
with committed changes rather than tree size. Responses contain `cursor` and
`hasMore`; clients continue until `hasMore` is false.

Change rows and mutation receipts are retained for 30 days. A cursor older than
retained history receives `410 { resetRequired: true }`; the client then fetches
one fresh tree snapshot. A revoked tree returns `404`, prompting a manifest
refresh.

## Mutations

`POST /api/mutations` accepts one logical normalized mutation:

```ts
{
  protocolVersion: 2
  deviceId: string
  mutationId: string
  records: SyncPushRequest
}
```

Every synchronized row carries a server-owned positive integer `revision`.
Existing updates and tombstones must send the revision last observed from the
server. New records omit it. Client timestamps are metadata only and never
decide write ordering.

The server serializes duplicate mutation IDs, checks ACL and graph invariants,
and applies the complete logical mutation in one interactive PostgreSQL
transaction. If any record conflicts, the transaction rolls back and returns
`409` with `status: "conflict"`; no prefix is committed. Conflict responses also
include `conflict: { retryable, reason, records }`, where `records` contains the
authoritative server versions needed for comparison and rebasing. A retry of a committed
mutation returns its stored result with `status: "alreadyApplied"`.

```ts
{
  mutationId: string
  status: "applied" | "alreadyApplied" | "conflict"
  applied: SyncAppliedIds
  skipped: SyncAppliedIds
  aliases?: {
    parentChildRelationships: Record<string, {
      id: string
      revision: number
      type: ParentChildRelationshipType
    }>
  }
  serverTime: string
}
```

Canonical parent ID substitutions and association revisions are returned in
`aliases`, allowing the client to remap facts, associations, and queued work
without waiting for a reload.

Payloads are limited to 5 MiB, 2,000 records per collection, and 5,000 records
overall. IDs, text, dates, photos, enums, exact keys, and duplicate collection
keys are validated before database or Blob work.

## Shares

`GET`, `POST`, and `DELETE /api/trees/[treeId]/shares` are owner-only. Requests
use bounded JSON parsing, normalized email addresses, deterministic ordering,
and strict roles. Pending shares are reconciled during manifest loading, which
also closes the share/user-creation race.

## Access requests

`GET /api/trees/[treeId]/access-request` returns the requesting user's own
request (status + comment) or `null`. `POST` creates or reopens a pending
request and requires a session, a non-deleted tree, no existing role, and a
non-empty comment of at most 500 characters.

`GET /api/trees/[treeId]/access-requests` (owner-only) lists pending requests
with the requester's name, email, comment, and timestamp. `POST` (owner-only)
resolves one with `{ userId, action: "approve" | "deny" }`; `approve` inserts a
`viewer` share and marks the request `approved` in one transaction.

## Photos

`GET /api/person-photo/[personId]` authorizes every request and returns
`private, no-store` image responses with content-type allowlisting, byte limits,
and `nosniff`. Blob URLs are never exposed in sync DTOs.

## Bulk pull and deletion

`GET /api/sync?since=<iso>` returns an authoritative full pull across every
tree the account can access; the client uses it to reconcile after incremental
change synchronization reports divergent or skipped records. `DELETE
/api/trees/[treeId]` is owner-only and atomically tombstones a tree and its
tree-local records. Writes go through `POST /api/mutations`, so revisions,
atomicity, idempotency, and change records cannot be bypassed.
