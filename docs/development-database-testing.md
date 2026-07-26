# Development Database Testing

Use this guide to verify schema migrations, normalized family CRUD, sync, and
permissions against a development database. Never use a production connection
string for these steps.

## Safety rules

- Use a dedicated Neon development branch or database.
- Keep connection strings in `.env.local` or the shell environment. Never commit
  credentials or paste them into documentation.
- Back up a database before testing a migration that changes existing data.
- Use `bun run db:migrate`, not `bun run db:push`. The migration contains data
  conversion and integrity checks that `db:push` bypasses.
- Match the `pg_dump` major version to the PostgreSQL server major version.

## Configure the development database

Copy the environment template and set the development credentials:

```bash
cp .env.local.example .env.local
```

At minimum, set:

```dotenv
DATABASE_URL=postgresql://user:password@development-host/database?sslmode=require
BETTER_AUTH_SECRET=development-only-secret
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=development-google-client-id
GOOGLE_CLIENT_SECRET=development-google-client-secret
```

Confirm that `DATABASE_URL` points to the development database before running
any database command.

Load `.env.local` into the current shell before using commands that read
`DATABASE_URL` directly:

```bash
set -a
source .env.local
set +a
```

## Back up existing development data

When `pg_dump` and `pg_restore` are installed locally:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="/tmp/family-tree-dev-before-migration.dump"

pg_restore --list "/tmp/family-tree-dev-before-migration.dump"
sha256sum "/tmp/family-tree-dev-before-migration.dump"
```

Docker can provide matching PostgreSQL client tools when they are not installed.
Replace `17-alpine` if the development server uses another major version:

```bash
docker run --rm \
  --volume "/tmp:/backup" \
  postgres:17-alpine \
  pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --file="/backup/family-tree-dev-before-migration.dump"

docker run --rm \
  --volume "/tmp:/backup" \
  postgres:17-alpine \
  pg_restore --list "/backup/family-tree-dev-before-migration.dump"
```

A backup is verified only after `pg_restore --list` can read it. Store important
backups outside `/tmp` after verification.

## Run and validate migrations

Apply all committed migrations:

```bash
bun run db:migrate
```

Then run the read-only normalized database validator:

```bash
bun run db:validate
```

The validator must report `Normalized database validation passed`. It checks:

- The legacy `trees.edges` column is absent.
- All normalized tables and columns exist.
- Active memberships and relationship associations reference active records.
- Union endpoints are canonical and distinct.
- Parent-child relationships are distinct, limited to two active parents, and
  contain no ancestry cycle.
- Person gender values are valid.
- Active and tombstoned record counts can be read for every normalized table.

Running `bun run db:migrate` again should be a no-op.

## Run automated application checks

Before manual CRUD testing:

```bash
bun test
bun run typecheck
bunx biome check .
bun run build
```

Start the application against the development database:

```bash
bun run dev
```

Open `http://localhost:3000` and sign in with development accounts.

## Manual normalized CRUD checks

Use two or three trees that reference the same person and relationships.

| Check | Expected result |
|---|---|
| Create family A and add people | Reloading preserves people, memberships, unions, and parent links. |
| Link the same person into family B | Both trees reference one person identity rather than duplicate identity data. |
| Edit the shared person's name in A | The name changes in A and B, including after reload. |
| Add a spouse relationship to A and B | Both trees reference one canonical union. |
| Change the marriage date in A | The date changes in every tree associated with that union. |
| Mark a parent relationship adoptive in A | The relationship type changes in every associated tree. |
| Unlink a spouse in A | The union disappears from A but remains visible in B. |
| Remove a parent from A | The parent link disappears from A but remains visible in B. |
| Remove a person from A | The person and shared facts remain available in B. |
| Merge duplicate people from writable trees | Relationships move to immutable replacement facts and survive reload. |
| Delete a person globally | The person and all related memberships and facts disappear from every tree. |

The UI currently edits marriage/divorce history and biological/adoptive parent
types. The schema supports additional union events and parent types.

## Permission checks

Create separate owner, editor, and viewer development accounts.

| Role | Expected behavior |
|---|---|
| Owner | Can rename/delete the tree, manage shares, and edit tree data. |
| Editor | Can edit people and tree associations but cannot rename/delete the tree or manage shares. |
| Viewer | Can read the tree but cannot create, edit, merge, unlink, or delete data. |

Also verify:

- A viewer-only tree is not offered as a same-person merge source.
- Revoking a share removes the tree after the next manifest refresh.
- Switching directly between signed-in accounts clears the previous account's
  local store before loading the next account.
- A conflicting optimistic write remains visible and marked `conflict`; editing
  it again rebases on the authoritative server revision.
- Reloading while offline preserves pending edits in IndexedDB and retries them
  after connectivity returns.
- Two tabs editing the same record produce an explicit revision conflict rather
  than silently replacing local intent.

## Optional local PostgreSQL migration rehearsal

The application uses the Neon serverless Pool driver, so `drizzle-kit migrate` is intended
for Neon-compatible databases. For a local PostgreSQL container, execute the SQL
migrations directly with `psql`:

```bash
docker run --rm --detach \
  --name family-tree-postgres-test \
  --env POSTGRES_PASSWORD=test \
  --env POSTGRES_DB=family_tree_test \
  --publish 55432:5432 \
  postgres:17-alpine

until docker exec family-tree-postgres-test pg_isready --username postgres
do
  sleep 1
done

docker cp drizzle/0000_baseline.sql \
  family-tree-postgres-test:/tmp/0000_baseline.sql
docker cp drizzle/0001_normalize_family_data.sql \
  family-tree-postgres-test:/tmp/0001_normalize_family_data.sql

docker exec family-tree-postgres-test \
  psql --set ON_ERROR_STOP=1 --single-transaction \
  --username postgres --dbname family_tree_test \
  --file /tmp/0000_baseline.sql

docker exec family-tree-postgres-test \
  psql --set ON_ERROR_STOP=1 --single-transaction \
  --username postgres --dbname family_tree_test \
  --file /tmp/0001_normalize_family_data.sql

docker stop family-tree-postgres-test
```

For realistic legacy data, prefer a disposable Neon branch cloned from the
development database. This exercises the same driver, PostgreSQL version, and
data volume without risking the primary development database.

## Failure handling

- Do not rerun `db:push` after a migration failure.
- Read the migration error code and affected person/tree IDs. The normalization
  migration aborts instead of choosing between conflicting facts.
- Verify that the transaction rolled back and `trees.edges` still exists before
  correcting legacy data.
- Correct ambiguous data in a reviewed repair script or restore a backup, then
  rerun `bun run db:migrate`.
- Run `bun run db:validate` after every successful migration or repair.

## Completion checklist

- Verified backup created before migration.
- `bun run db:migrate` completed successfully.
- `bun run db:validate` passed.
- Automated tests, typecheck, formatting, and build passed.
- Shared identity, marriage date, and adoption updates propagated across trees.
- Tree-local unlink and removal did not delete shared facts from other trees.
- Owner, editor, and viewer behavior matched the permission matrix.
- Reloaded data matched the state shown before refresh.
