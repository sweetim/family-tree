# Database

Persistence uses Drizzle ORM on Neon Postgres through the serverless HTTP
driver. The current schema is defined in `src/db/schema.ts`; the lazy client is
in `src/db/index.ts`.

## Client setup

- `createClient()` reads `DATABASE_URL`, creates the Neon HTTP driver, and wraps
  it with Drizzle and the schema.
- `getDB()` creates a module-level singleton on the first query. Importing the
  module does not connect, so anonymous pages can boot without a database.
- Each query uses the fetch-backed driver; this suits Bun development and
  serverless functions.

## Tables

Better Auth owns `user`, `session`, `account`, and `verification`. Their column
names are snake_case, matching the Drizzle adapter defaults.

Application data is normalized:

| Table | Purpose and important columns |
|---|---|
| `persons` | Shared identity: `id`, `owner_id`, name, birth/death dates, gender, location, `photo` text, `updated_at`, `deleted_at`. |
| `trees` | Tree metadata only: `id`, `owner_id`, name, creation/update timestamps, tombstone. |
| `tree_shares` | Pending or bound viewer/editor grants, keyed by `(tree_id, email)`; `user_id` is nullable until the invitee signs in. |
| `tree_members` | Tree-local person membership, keyed by `(tree_id, person_id)`. |
| `unions` | Shared canonical pair of people. Endpoint ids are immutable, distinct, ASCII, and stored in C-collation order. |
| `union_events` | Shared union history with an optional calendar date. |
| `tree_unions` | Tree-local association between a tree and a shared union. |
| `parent_child_relationships` | Shared parent/child fact and relationship type. Endpoint ids are immutable and distinct. |
| `tree_parent_child_relationships` | Tree-local association between a tree and a shared parent/child fact. |

`union_event_type` supports `relationship_started`, `engaged`, `married`,
`civil_union`, `domestic_partnership`, `separated`, `reconciled`, `divorced`,
`annulled`, and `relationship_ended`. The Core UI currently creates marriage
facts and edits their date; the broader enum preserves the history model.

`parent_child_relationship_type` supports `biological`, `adoptive`, `foster`,
`guardian`, and `step`. The Core UI currently toggles biological/adoptive.

## Facts and associations

`persons`, `unions`, `union_events`, and `parent_child_relationships` are
canonical shared facts. Editing identity, a marriage date, or adoption type is
therefore visible in every associated tree.

`tree_members`, `tree_unions`, and `tree_parent_child_relationships` are
tree-local associations. Unlinking a spouse, removing a parent, or removing a
person from a tree tombstones only that tree's associations. It does not delete
the shared fact or detach another tree.

All normalized records except `tree_shares` have update timestamps and, where
sync deletion is supported, tombstones. Foreign keys use hard cascades for
referential cleanup, while normal sync deletion is soft. A person-owner delete
is the exception at the protocol level: one atomic server statement tombstones
the person and every membership, union, union event, parent/child fact, and tree
association involving that person.

## One-time normalization migration

The committed migration sequence is intentionally one-time:

1. `0000_baseline.sql` establishes and verifies the deployed legacy baseline
   without recreating existing tables.
2. `0001_normalize_family_data.sql` creates the normalized enums and tables,
   locks legacy relationship/person writes, validates the source, copies and
   deduplicates canonical facts, verifies a round trip, adds constraints and
   indexes, and drops the legacy relationship column.

The preflight is strict and aborts the transaction instead of guessing. It
rejects malformed or unsupported records, dangling/nonmember endpoints,
duplicates, self-links, conflicting shared dates or parent types, invalid
dates/genders/ids, more than two active global parents, ancestry cycles, and
synthetic id or round-trip mismatches.

For an existing or new environment:

1. Schedule a maintenance window and stop old application instances from
   writing. They are incompatible after normalization.
2. Take a verified backup and rehearse the migration against a restore.
3. Run `bun run db:migrate`.
4. Run `bun run db:validate` and review the active/tombstoned counts.
5. Deploy the normalized application only after validation passes.

Do not use `bun run db:push` for setup. It bypasses the ordered data migration
and its preflight. Use `db:generate` only when authoring a reviewed future
migration.

`db:validate` verifies the normalized columns, confirms the legacy column is
gone, checks active association endpoints, canonical unions, person gender,
parent limits and cycles, and prints counts for all normalized tables.
