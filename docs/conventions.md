# Conventions

The root [`AGENTS.md`](../AGENTS.md) is the source of truth. This file summarizes
the workflow, commands, environment, and configuration.

## Workflow

- Present a plan and wait for approval before implementation; confirm revisions
  before editing.
- Prefer the minimum code that solves the requested problem.
- Touch only required lines and preserve surrounding style.
- Define verifiable success criteria and run the relevant checks.
- Update documentation when behavior changes and provide manual checks for UI
  work.

## Code

- Use `type` rather than `interface` for new TypeScript types.
- Prefer `ts-pattern@5` for exhaustive pattern matching where appropriate.
- Use full names rather than abbreviations.
- Use Bun rather than Node.js.
- Add comments only when complex code is not self-explanatory.

## Commands

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies. |
| `bun run dev` | Start the Turbopack development server. |
| `bun run build` | Build production output. |
| `bun run start` | Serve production output. |
| `bun run typecheck` | Run TypeScript without emitting files. |
| `bun test` | Run the Bun test suite. |
| `bun run db:generate` | Generate a reviewed SQL migration after a schema change. |
| `bun run db:migrate` | Apply committed migrations in order. |
| `bun run db:validate` | Validate normalized schema/data and print active/tombstoned counts. |
| `bun run db:push` | Direct schema synchronization; do not use for setup or the normalization migration. |

For database setup or rollout, take a backup and use a maintenance window, then
run `bun run db:migrate` followed by `bun run db:validate`. Never substitute
`db:push`; it skips the committed one-time baseline, normalization preflight,
data copy, and round-trip checks. See [database.md](./database.md).

Tombstoned rows are purged automatically by the `0 0 */7 * *` cron in
`vercel.json` (`/api/cron/purge-tombstones`, gated by `CRON_SECRET`). The same
cascade-safe logic is available on demand via
`bun run db:purge-tombstones [--apply]`.

Run `bun run typecheck` and relevant tests after non-trivial source changes.
Biome has no separate package script; its configured file set currently covers
TypeScript and TSX, not Markdown.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Required by migrations, validation, auth, and sync queries. |
| `BETTER_AUTH_SECRET` | Better Auth secret. |
| `BETTER_AUTH_URL` | Deployed base URL without a trailing slash; use `http://localhost:3000` locally. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. Redirect URIs end in `/api/auth/callback/google`. |
| `CRON_SECRET` | Bearer secret that authorizes the weekly `/api/cron/purge-tombstones` job. Required in production; omitted locally (the route returns 401 without it). |

Local setup: create `.env.local` from the provided example, fill in the values,
then run `bun run db:migrate` and `bun run db:validate` against the intended
database.

## Configuration

| File | Summary |
|---|---|
| `next.config.ts` | React strict mode. |
| `vercel.json` | Weekly `0 0 */7 * *` cron that calls `/api/cron/purge-tombstones` (authorized by `CRON_SECRET`). |
| `biome.json` | Recommended linter and formatter rules for TypeScript/TSX. |
| `tsconfig.json` | Strict bundler-mode TypeScript with Bun/React types and `@/*` path alias. |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS plugin. |
| `global.d.ts` | CSS module declaration for side-effect imports. |
| `drizzle.config.ts` | PostgreSQL schema path, migration output, and `DATABASE_URL`. |

Vercel auto-detects Next.js; `vercel.json` only declares the weekly
tombstone-purge cron. Environment values must be configured for each deployment
environment.

Tailwind tokens and React Flow overrides live in `src/app/globals.css`,
including the Inter font, cobalt palette, shadows, animations, application
background, glass surface, scrolling, controls, and minimap styles.
