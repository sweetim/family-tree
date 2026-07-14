# Family Tree

An interactive family tree builder. Register family members with their name,
date of birth, location and a photo, and see them laid out automatically as a
tree.

Built with **Bun + React 19 + Tailwind CSS v4 + React Flow (@xyflow/react)**,
auto-layout by **dagre**. Data is persisted in the browser's localStorage;
photos are downscaled client-side before being stored. Export/Import lets you
back up or share a tree as JSON.

## Development

```bash
bun install
bun run dev        # http://localhost:3000
```

## Production build

```bash
bun run build      # static site in ./dist
```

## Deploy to Vercel

The app ships as a static site — `vercel.json` already configures the Bun
install/build commands and the SPA rewrite:

```bash
bunx vercel deploy
```

or connect the repo on vercel.com; no extra configuration or environment
variables are needed.
