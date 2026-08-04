# Family Tree

An interactive family-tree builder. Add family members and watch them laid out
automatically as a clean, navigable tree. Sign in with Google, build multiple
trees, link the same person across them, and share each tree with others.

## Features

- **Add anyone** — given and family names, partial or full birth/death dates,
  gender, birthplace, and a profile photo. Lifeline badges show age, or
  birth–death years.
- **Automatic layout** — partners sit side by side and children appear in birth
  order. Pan, zoom, and use the minimap to navigate large trees.
- **Click-to-connect relationships** — add parents, spouses, and children right
  from the canvas.
- **Rich relationships** — biological, adoptive, foster, guardian, and step
  parents are all supported.
- **Marriages** — set marriage dates and mark divorces; hover a couple's junction
  to see the date.
- **Photos cropped in your browser** — drag to position, zoom to fit, no raw
  uploads, or paste a photo directly from your clipboard.
- **One person, many trees** — link the same person into multiple trees without
  duplicating their details. Merge duplicate records or extract a person and
  their family into a new tree.
- **Customizable views** — highlight bloodlines, focus the selected person,
  filter descendants, show related families together, and choose which card
  details appear on the canvas.
- **Work offline** — edits are kept locally and sync in the background when
  you reconnect. Review and resolve conflicting edits when necessary.
- **Search everyone** — find any person across all your trees in one box.
- **Sharing** — invite people by email as a **viewer** (read-only) or **editor**.
  Invited before they sign up? They get access on first sign-in. Visitors who
  reach a share URL without an invite can **request access** with a short note,
  and the owner approves or declines from the Share dialog or dedicated sharing
  page.
- **Manage trees** — create a sample tree, rename or delete trees, and review
  sharing and access requests across every tree you own.
- **Export & import** — back up or transfer a tree as a single JSON file,
  export it as GEDCOM, or print the whole tree to a PDF.
- **Sign in with Google** — your trees are private to your account.
- **Try it instantly** — create a sample tree with one click.

## Get started

```bash
bun install
bun run dev        # http://localhost:3000
```

This requires a Postgres database and Google OAuth credentials. Copy
[.env.local.example](./.env.local.example) and fill it in; see the docs below for
full setup, migrations, and deployment.

## Documentation

Technical reference (architecture, data model, auth/sharing, API, layout, and
conventions) lives in [`docs/`](./docs) — start with
[`docs/README.md`](./docs/README.md).
