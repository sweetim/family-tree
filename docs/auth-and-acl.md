# Authentication and Access Control

Sign-in uses Better Auth with Google. Authorization combines per-tree roles
with ownership of shared person records.

## Authentication

`src/server/auth.ts` configures the Drizzle adapter for `user`, `session`,
`account`, and `verification`, plus the Google provider. The server auth object
and database client are lazy, so anonymous rendering does not require a
database connection.

The browser client in `src/lib/auth-client.ts` exports `signIn`, `signOut`, and
`useSession` against same-origin `/api/auth/*`.

### Pending shares

Owners can share with an email before that person has an account. Such a
`tree_shares` row has `user_id = null`. Better Auth's post-create hook binds all
matching pending rows to a newly created user, making the trees available on
their first sign-in.

### Access requests

A visitor who reaches a share URL but has not been invited can request access.
The signed-in, no-access view of `/tree/[treeId]` shows a request card with a
short "who are you?" note. The request is stored in `tree_access_requests`
(status `pending` / `approved` / `denied`, one row per tree + requester). The
owner reviews pending requests from the Share dialog; approving inserts a
`viewer` share row in the same transaction, so the requester gains read-only
access on their next load. Denying marks the request `denied`; the requester
may re-request, which reopens the row to `pending`.

Resolution is conditional on an existing pending row. The API never resolves an
arbitrary user ID, and share-list responses do not expose account IDs or account
registration state.

### Email notifications

When transactional email is configured (SMTP env vars in `.env.local`),
`src/server/email.ts` sends notifications over SMTP (e.g. Zoho Mail):

- A **new request** emails the tree owner (a link to the `/sharing` page).
- **Resolving** a request emails the requester, both on approve and deny.

Delivery is best-effort: a send failure (or missing SMTP config) is logged and
never blocks the request or approval. Configure `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, and `SMTP_PASSWORD` to enable it; leave them blank to disable.

## Roles

`Role` is `owner | editor | viewer`, ordered from strongest to weakest. A
deleted tree has no role.

| Role | Behavior |
|---|---|
| `owner` | Read and edit tree content; create, rename, and delete the tree; manage shares. Tree ownership also grants owner-level access to active member identities. |
| `editor` | Read and edit active member identities, shared relationship facts, and tree-local associations. Cannot rename/delete the tree or manage shares. |
| `viewer` | Read the tree and its active normalized snapshot. The Core UI is read-only and hides mutating affordances. |

Only the owner of a `persons` row may globally delete that person, even when
another user owns or edits a tree containing them. The user who creates a new
person becomes its row owner.

## Role resolution

`treeRole` returns owner for the tree owner, otherwise the strongest bound share
role, or null for missing/deleted/inaccessible trees.

`personRole` joins active `tree_members` to active trees and shares. It returns
the strongest of:

- ownership of the person row;
- ownership of any active tree containing the person;
- editor/viewer access to any active tree containing the person.

This maximum-role rule lets an editor update a shared identity even if the same
person appears in another tree they can only view. The client still treats a
viewer tree as read-only; write access gained elsewhere is enforced at the
server record boundary.

## Enforcement

Authorization is enforced inside handlers:

- Person identity updates use `personRole`; person deletion requires person-row
  ownership and triggers the global cascade.
- Tree metadata updates/deletes and all share operations require tree
  ownership.
- Membership and tree association changes require owner/editor access to that
  tree.
- Creating a union or parent/child fact requires both endpoints to be active
  members of a writable tree.
- Existing union/event and parent facts require a writable associated tree;
  callers owning both person endpoints are also allowed to write the fact.
- Global union, event, and parent-fact tombstones are not accepted from clients.
  Core unlink/remove operations tombstone only tree associations.

See [api-reference.md](./api-reference.md) for record constraints and server
timestamp behavior.
