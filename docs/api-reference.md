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
current sync version. Responses are capped at 6 MiB and return `nextCursor`
when another page is required. Clients assemble every page before treating the
snapshot as authoritative. A version change between pages returns `409` and
requires a restart. Other accessible trees are not included.

`GET /api/trees/[treeId]/graph?focusPersonId=<id>&radius=<0-6>` returns at
most 300 people in a relationship neighborhood around one member. The response
sets `partial: true` and identifies boundary people. Person deep links use this
bounded query; the main tree canvas uses the selected-tree snapshot.

`GET /api/people/search?query=<text>` accepts queries of 3-100 characters,
searches accessible identities without loading their trees, and returns at most
eight results.

`GET /api/trees/[treeId]/invite` is the one unauthenticated tree endpoint. It
returns just the tree's public name (`{ name }`) for share-link previews and
invite landing pages, or `404` for a missing/deleted tree. The response is
cacheable for 60 seconds; no membership or role is exposed.

## Changes

`GET /api/changes?treeId=<id>&cursor=<opaque>&limit=<1-100>` returns ordered
normalized change batches after the supplied cursor. The work and payload scale
with committed changes rather than tree size. Responses contain `cursor` and
`hasMore`; clients continue until `hasMore` is false.
Pages are also capped at 6 MiB. An individual historical batch that cannot fit
causes `410 resetRequired` rather than an oversized response.

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
decide write ordering. A person record may carry `force: true` when the user
explicitly resolves a conflict toward their local version; the server then
ignores the revision precondition for that row. Forced person upserts remain
ACL-gated and cannot resurrect a tombstoned row.

The server serializes duplicate mutation IDs, checks ACL and graph invariants,
and applies the complete logical mutation in one interactive PostgreSQL
transaction. If any record conflicts, the transaction rolls back and returns
`409` with `status: "conflict"`; no prefix is committed. Conflict responses also
include `conflict: { retryable, reason, records }`, where `records` contains the
authoritative server versions needed for comparison and rebasing. A missing
parent fact returns `reason: "missing-parent-relationship"` plus the exact IDs
in `missingDependencies.parentChildRelationships`, allowing the client to
recreate only those dependencies. A retry of a committed mutation returns its
stored result with `status: "alreadyApplied"`.

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

Writes are serialized by parent-graph, union, and tree scope. A tree may contain
at most 10,000 active members and 20,000 active relationship, association, and
event records. A mutation that would increase an over-limit count returns a
non-retryable `409` conflict.

## Shares

`GET`, `POST`, and `DELETE /api/trees/[treeId]/shares` are owner-only. List
responses use `cursor` and `limit` keyset pagination. Requests use bounded JSON
parsing, normalized email addresses, deterministic ordering, and strict roles.
Responses do not expose internal user IDs or whether an invited email already
has an account. Pending shares are reconciled during manifest loading.

`GET /api/shares` (owner-only, unpaginated) returns an overview of every share
across the caller's (non-deleted) trees, grouped by email as `{ email, name,
pending, trees: [{ treeId, treeName, role }] }`. Unlike the per-tree list it
joins `user` to surface the name and a `pending` flag (`userId` still null —
invitee hasn't signed in). Powers the HomePage "Sharing" dialog overview.

`PATCH /api/shares` (owner-only) batch-mutates shares across the caller's
trees in one request. The body is `{ changes: [{ email, treeId, role }] }`,
where `role` is `editor`, `viewer`, or `null` to revoke. Each entry must
reference a tree the caller owns and an email other than their own; duplicates
by `treeId` + `email` are rejected. Changes are bounded, validated up front,
and applied within the per-tree share rules used by the single-share endpoints.

## Access requests

`GET /api/trees/[treeId]/access-request` returns the requesting user's own
request (status + comment) or `null`. `POST` creates or reopens a pending
request and requires a session, a non-deleted tree, no existing role, and a
non-empty comment of at most 500 characters.

`GET /api/trees/[treeId]/access-requests` (owner-only) lists pending requests
with the requester's name, email, comment, and timestamp using cursor pagination.
`POST` (owner-only) resolves one with `{ userId, action: "approve" | "deny" }`.
The request must exist and still be pending; missing requests return `404` and
already-resolved requests return `409`. Approval preserves an existing editor
role and marks the request `approved` in the same transaction.

`GET /api/access-requests?cursor=<opaque>&limit=<1-100>` (owner-only) lists
pending requests across **all** trees the caller owns, using stable keyset
pagination. Each row carries `treeId`, `treeName`, `userId`, `email`, `name`,
`comment`, and `createdAt`. The response also includes a `total` count so the
account menu can render a notification badge without loading every page.

## Photos

`GET /api/person-photo/[personId]` authorizes every request and returns
`private, max-age=31536000, immutable` image responses (cacheable because the
proxy URL carries a `?v={updatedAt}` version token), with content-type
allowlisting, byte limits, and `nosniff`. Blob URLs are never exposed in sync
DTOs.

## Bulk pull and deletion

`GET /api/sync?since=<iso>` returns an authoritative, 6 MiB paginated full pull
across every tree the account can access. The client follows `nextCursor` and
applies the result only after all pages arrive. `DELETE
/api/trees/[treeId]` is owner-only and atomically tombstones a tree and its
tree-local records. Writes go through `POST /api/mutations`, so revisions,
atomicity, idempotency, and change records cannot be bypassed.
