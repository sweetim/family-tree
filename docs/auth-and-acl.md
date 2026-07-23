# Authentication & Access Control

Sign-in is via **Better Auth** with Google. Authorization uses a three-role model
applied **per record**. Read this before touching sign-in, roles, or permission
checks.

## Authentication (`src/server/auth.ts`)

- `buildAuth()` — `src/server/auth.ts:19`. Configures Better Auth:
  - `baseURL` / `secret` from `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET`.
  - Drizzle adapter on the four core tables (`user`, `session`, `account`,
    `verification`) — see [database.md](./database.md).
  - Google social provider (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
- `getAuth()` — `src/server/auth.ts:53`. Lazy singleton (the app can boot without
  `DATABASE_URL`; anonymous mode works until an auth request needs the DB).
- `handleAuth(request)` — `src/server/auth.ts:59`. Fetch handler mounted at
  `/api/auth/*`.

### Pending-share binding on first sign-in

`databaseHooks.user.create.after` (`src/server/auth.ts:36`) runs after a new user
is created: it updates any `treeShares` rows matching the new user's email with a
null `userId` to set `userId = created.id`. This means shares created by an owner
**before** the invitee has ever signed in are bound automatically on first login,
so shared trees appear immediately.

### Browser client (`src/lib/auth-client.ts`)

Better Auth browser client against same-origin `/api/auth/*`. Exports `signIn`,
`signOut`, and `useSession`. The session hook re-fetches on mount, on window
focus, and on cross-tab sign-in/out.

## Role model

- Server roles: `Role = "owner" | "editor" | "viewer"` — `src/server/acl.ts:5`.
- Client roles: `LocalRole = "owner" | "viewer" | "editor"` — `src/store.ts:17`
  (same three values; "owner" for trees the current user owns).
- Rank order: `viewer (1) < editor (2) < owner (3)` — `src/server/acl.ts:7`.

Guards (`src/server/acl.ts`):

- `canWrite(role)` — `:89`. `true` for `owner` or `editor`.
- `canRead(role)` — `:93`. `true` when `role !== null`.

## Access-control functions (`src/server/acl.ts`)

- `treeRole(db, userId, treeId)` — `src/server/acl.ts:11`. Highest role `userId`
  has on `treeId`, or `null` if the tree is deleted/missing. Returns `"owner"` if
  `tree.ownerId === userId`, otherwise the matching `treeShares.role`, else null.
- `personRole(db, userId, personId)` — `src/server/acl.ts:55`. Highest role
  `userId` has on a person. Uses a raw SQL join (`:66`) to find every accessible
  (owned or shared) tree whose `edges -> 'members'` contains the person, then
  takes the **highest role** across: ownership of the person row, ownership of any
  containing tree, or a share role.
- `resolvePersonRole(userId, person, accessibleTrees)` — `src/server/acl.ts:33`.
  The **pure** version of `personRole`, extracted for unit testing without a DB.
  Handles tombstones and the multi-tree max-role logic.
- `userEmail(db, userId)` — `src/server/acl.ts:98`. Email of `userId`, used to
  label shared-with-me trees.

### Why per-person roles take the max across trees

Because a person can belong to many trees, a user's effective permission on that
person is the strongest role they hold on **any** tree containing the person (or
ownership of the person row). This is what lets an editor of one tree edit a
person who also appears in a tree they only view. See tests in
`src/server/acl.test.ts`.

## How roles are enforced

Roles are checked inside the server handlers, not in the route wrappers:

- **Sync push** (`postSync`): per-record. Each person/tree in the batch is checked
  individually with `canWrite(role)`; the requester becomes the owner of brand-new
  records. Editors can change a tree's `edges` but **only owners can rename** a
  tree. Details in [api-reference.md](./api-reference.md).
- **Shares** (`listShares`/`addShare`/`removeShare`): **owner-only**, enforced by
  `requireOwner` (`src/server/handlers/shares.ts:15`).

## Read-only behavior on the client

`useFamily(treeId)` exposes `readOnly = meta.role === "viewer"`
(see [state-and-sync.md](./state-and-sync.md)). The UI uses this to disable
editing and show read-only views.
