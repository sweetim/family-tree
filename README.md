# Family Tree

An interactive family tree builder. Register family members with their name,
date of birth, location and a photo, and see them laid out automatically as a
tree.

Built with **Next.js (App Router) + React 19 + Tailwind CSS v4 + React Flow
(@xyflow/react)**, auto-layout by **dagre**. Data is persisted in the browser's
localStorage; photos are downscaled client-side before being stored.
Export/Import lets you back up or share a tree as JSON. Sign in with Google
(Better Auth) enables cloud sync and per-tree sharing via Neon Postgres.

## Development

```bash
bun install
bun run dev        # http://localhost:3000
```

## Production build

```bash
bun run build      # outputs to .next
bun run start      # serve the production build
```

## Tests

```bash
bun test
```

## Deploy to Vercel

Next.js is detected automatically by Vercel — no `vercel.json` is needed.
Connect the repo on vercel.com and set the environment variables from
`.env.local.example` (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
