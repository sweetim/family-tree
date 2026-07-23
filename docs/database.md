# Database

Persistence layer: **Drizzle ORM** on **Neon Postgres** via the serverless HTTP
driver. Schema is defined in `src/db/schema.ts`; the client in `src/db/index.ts`.

## Client setup (`src/db/index.ts`)

- `createClient()` — `src/db/index.ts:11`. Reads `DATABASE_URL` (throws if unset),
  builds a Neon HTTP `sql` driver, and wraps it with `drizzle({ client, schema })`.
  One fetch-backed connection per query; fine for Vercel functions and Bun dev.
- `getDB()` — `src/db/index.ts:24`. Lazy module-level singleton — importing does
  not connect; it only throws on first query without `DATABASE_URL`. This lets
  the app boot in anonymous mode without a database.
- `DB` — `src/db/index.ts:29`. Inferred type returned by handlers.

## Schema (`src/db/schema.ts`)

Field names for Better Auth tables are **snake_case** (the Drizzle adapter
default), so the auth instance needs no explicit mapping.

### Better Auth core tables

| Table | Location | Key columns |
|---|---|---|
| `user` | `:18` | `id`, `name`, `email` (unique), `emailVerified`, `image`, `createdAt`, `updatedAt`. |
| `session` | `:32` | `id`, `expiresAt`, `token` (unique), `userId → user` (cascade), `ipAddress`, `userAgent`, timestamps. |
| `account` | `:49` | OAuth account: `accountId`, `providerId`, `userId → user` (cascade), `accessToken`, `refreshToken`, `idToken`, expiry timestamps, `scope`, `password`. |
| `verification` | `:75` | `identifier`, `value`, `expiresAt`, timestamps. |

### App tables

| Table | Location | Key columns | Notes |
|---|---|---|---|
| `persons` | `:92` | `id`, `ownerId → user` (cascade), `name`, `dob`, `dod`, `gender`, `location`, `photo`, `updatedAt`, `deletedAt` | **Global identity rows** mirroring `PersonIdentity`. `photo` is a text data URL. `deletedAt` is the soft-delete tombstone. |
| `trees` | `:109` | `id`, `ownerId → user` (cascade), `name`, `edges` (jsonb typed as `TreeEdges`), `createdAt`, `updatedAt`, `deletedAt` | **Relationship edges are stored as a single JSONB column** (`members`, `spouses`, `parents`). |
| `shareRole` | `:125` | `pgEnum("share_role", ["viewer", "editor"])` | |
| `treeShares` | `:127` | composite PK `(treeId, email)`; `email`, `userId → user` (set null), `role`, `createdAt` | `userId` is **nullable** so a share can be created before the invitee signs in (a "pending" share). |

### Relations (`:149`–`168`)

Readable shapes only (used by sync queries): `user` has many
sessions/accounts/ownedPersons/ownedTrees; `trees` has one owner + many shares;
`treeShares` → tree + user; `persons` → owner.

## Migrations (`drizzle.config.ts`)

`defineConfig` with schema `./src/db/schema.ts`, output `./drizzle`, dialect
`postgresql`, `DATABASE_URL`. Scripts (in `package.json`):

- `bun run db:generate` — generate SQL migrations from schema changes.
- `bun run db:push` — push schema directly to the database (used for initial
  setup; see `.env.local.example`).
- `bun run db:migrate` — run generated migrations.

## Things to keep in mind

- **Soft deletes via tombstones.** Rows are not hard-deleted; `deletedAt` is set
  and the sync layer treats tombstoned records as deletes.
- **Edges are JSONB.** A tree's whole relationship graph is one JSON column, so
  edits to membership/spouses/parents update the tree's `updatedAt`.
- **Pending shares.** A `treeShares` row with `userId = null` becomes bound to a
  real user on their first sign-in (see [auth-and-acl.md](./auth-and-acl.md)).
