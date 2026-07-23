# Family Tree — Documentation

Reference documentation for the Family Tree app. Use these docs to understand the
architecture before making changes. All references point to source files with
`path:line` so you can open the exact location in the code.

## What this app is

An interactive, collaborative family-tree builder. Users register family members
(name, dates, location, photo) and the app lays them out automatically as a
genealogy chart. A single person can belong to multiple trees, so linking
families across trees is a first-class concept. Trees can be shared with other
users as **viewer** or **editor**, and every tree can be exported/imported as
JSON.

## Tech stack

- **Next.js 15** (App Router) + **React 19** — all routes are client components.
- **Tailwind CSS v4** for styling.
- **@xyflow/react** (React Flow) for the interactive tree canvas.
- **Drizzle ORM** on **Neon Postgres** (serverless HTTP driver) for persistence.
- **Better Auth** (Google OAuth) for authentication.
- **Bun** as the runtime and test runner.

## How to use these docs

Read in order if you are new to the codebase, or jump to a topic:

| Doc | When to read |
|---|---|
| [architecture.md](./architecture.md) | First. Big picture, request/data flow, folder map. |
| [domain-model.md](./domain-model.md) | Before touching how people, trees, and relationships are represented. |
| [state-and-sync.md](./state-and-sync.md) | Before touching client state, mutations, or the sync protocol. |
| [database.md](./database.md) | Before touching the schema, migrations, or any server query. |
| [auth-and-acl.md](./auth-and-acl.md) | Before touching sign-in, roles, or any permission check. |
| [api-reference.md](./api-reference.md) | Before adding/changing routes or API endpoints. |
| [layout.md](./layout.md) | Before touching how the tree is positioned or rendered. |
| [components.md](./components.md) | Before touching the UI (canvas nodes, sidebar, dialogs). |
| [conventions.md](./conventions.md) | Before any change. Coding rules, commands, env, config. |

## Project-level rules (read before any change)

Coding rules, simplicity/surgical-change guidelines, and the "plan before
coding" workflow live in the root [`../AGENTS.md`](../AGENTS.md). The key points
are summarized in [conventions.md](./conventions.md), but `AGENTS.md` is the
source of truth.

## Source layout at a glance

```
src/
  app/            Next.js App Router: pages, layout, providers, API routes
  components/     Shared UI (person/union nodes, dialogs, toast, confirm)
  db/             Drizzle schema + Neon client
  lib/            Pure helpers: layout, image, auth-client, tree-actions, view-settings
  server/         Server-only: auth, ACL, request handlers
  sync/           Wire types for the client<->server sync protocol
  types.ts        Core domain model (people, trees, relationships)
  store.ts        Client-side external store (state, mutations, sync push/pull)
```
