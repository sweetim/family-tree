# Conventions

Coding rules, commands, environment, and config. The source of truth for
workflow and coding rules is the root [`AGENTS.md`](../AGENTS.md); this file
summarizes the parts most relevant to making changes.

## Workflow rules (from `AGENTS.md`)

- **Plan before coding.** Present a plan and wait for approval before writing
  code; confirm the approach before implementing revisions.
- **Simplicity first.** Minimum code that solves the problem; no speculative
  features, abstractions, or error handling for impossible cases.
- **Surgical changes.** Touch only what the task requires; match existing style;
  don't refactor unrelated code. Remove only the orphans your own changes create.
- **Goal-driven.** Define verifiable success criteria (e.g. a test that must
  pass) and loop until met.

## Coding rules

- Use `type` instead of `interface` for TypeScript types. (Note: existing
  domain types in `src/types.ts` and `src/db/schema.ts` use `interface`; follow
  the surrounding file's style when editing those.)
- Prefer [`ts-pattern@5`](https://github.com/gvergnaud/ts-pattern) for pattern
  matching and exhaustive type handling.
- No abbreviations — use full names.
- Use the **Bun** runtime instead of Node.js.
- **Do not add comments** unless asked.

## Commands (`package.json`)

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies. |
| `bun run dev` | Dev server with Turbopack (`http://localhost:3000`). |
| `bun run build` | Production build (outputs to `.next`). |
| `bun run start` | Serve the production build. |
| `bun run typecheck` | `bunx tsc --noEmit`. |
| `bun test` | Run the test suite (`src/*.test.ts`). |
| `bun run db:generate` | Generate SQL migrations from schema changes. |
| `bun run db:push` | Push schema directly to Neon. |
| `bun run db:migrate` | Run generated migrations. |

Run `bun run typecheck` after non-trivial changes. There is no separate lint
script; Biome config is in `biome.json` (see below).

## Environment variables (`.env.local.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (`postgres://...?sslmode=require`). Auto-injected by the Vercel Neon integration. |
| `BETTER_AUTH_SECRET` | Auth secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | Deployed app base URL, no trailing slash (dev `http://localhost:3000`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client. Redirect URIs must include `/api/auth/callback/google` for localhost + preview/prod. |

Local setup: copy `.env.local.example` to `.env.local`, fill it in, then
`bun run db:push` to apply the schema to Neon.

## Config files

| File | Summary |
|---|---|
| `next.config.ts` | Minimal: `{ reactStrictMode: true }` only. |
| `biome.json` | Linter `recommended` preset with several overrides off; formatter uses 2-space indent, double quotes, semicolons `asNeeded`, multiline attributes, operator break **before**. Includes `**/*.ts(x)`, ignores `.next`. |
| `tsconfig.json` | `target/lib ESNext + DOM`, `moduleResolution: bundler`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `incremental`. Path alias `@/* → ./src/*`. `types: ["bun","react"]`. |
| `postcss.config.mjs` | Single plugin `@tailwindcss/postcss` (Tailwind v4). |
| `global.d.ts` | `declare module "*.css"` so `tsc --noEmit` resolves CSS side-effect imports. |
| `drizzle.config.ts` | schema `./src/db/schema.ts`, out `./drizzle`, `postgresql`, `DATABASE_URL`. |
| `bunfig.toml` | Not present; Bun uses defaults. Tests run via `bun test`. |

## Deployment

Next.js is auto-detected by Vercel — no `vercel.json` needed. Connect the repo on
vercel.com and set the environment variables above. The Vercel Neon integration
can inject `DATABASE_URL` automatically.

## Design tokens (`src/app/globals.css`)

Tailwind v4 `@theme` defines `--font-sans` (Inter via `next/font`), a custom
**cobalt** accent palette (`cobalt-50…900`), layered shadows
(`--shadow-soft/-lift/-glass`), keyframe animations (`fade-in`, `slide-up`,
`scale-in`, `toast-in`), and utility classes (`.app-bg`, `.glass`, `.scroll-area`)
plus React Flow overrides (clickable edges that turn red on hover, restyled
controls/minimap).
