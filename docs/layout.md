# Tree Layout

How the family tree is positioned and turned into a React Flow graph. All in
`src/lib/layout.ts`. Read this before changing how the tree is laid out or
rendered.

## Why a custom algorithm (not dagre)

`src/lib/layout.ts:47` documents the reasoning: generic layered layout (e.g.
dagre) reorders people within a generation to minimize crossings, which breaks
two invariants a family chart depends on:

1. **Partners must sit side by side** — the marriage line is drawn straight
   between them.
2. **Siblings must appear in birth order.**

Instead, the tree is laid out recursively. (Note: the project README still
mentions dagre historically, but the implementation is this custom algorithm.)

## The algorithm

Each subtree is a **"couple row"**: a person plus their partners chained
left-to-right. For a simple two-person couple there is a husband-left convention.
The children of each union hang below in birth order, centered under their
parents. A subtree's width is `max(rowWidth, kidsWidth)` so siblings never
overlap.

- `computePositions(...)` — `src/lib/layout.ts:58`. The recursive positioner.
  - Roots are people with no visible parents whose partners also lack parents
    (so a married-in spouse doesn't root a subtree their partner's parents own).
  - Children are grouped by their "unit" (`pairKey` for two visible parents, the
    lone parent id otherwise), sorted eldest-first then insertion order.

`buildFlow(people, selectedId?, linking?)` — `src/lib/layout.ts:240`. Turns the
positioned tree into React Flow nodes + edges:

- **Couples** = married pairs **plus** co-parents of any child. Union dots are
  nodes keyed `u:<pairKey>`, placed centered between partners.
- `pairKey(a, b)` — `src/lib/layout.ts:45`. Sorts the two ids and joins them with
  `:`, giving a stable key for a couple/union regardless of order.

## Constants (`src/lib/layout.ts`)

| Constant | Line | Value | Meaning |
|---|---|---|---|
| `NODE_WIDTH` | `:4` | `176` | Person card width. |
| `NODE_HEIGHT` | `:5` | `220` | Person card height. |
| `COUPLE_LINE_Y` | `:12` | `64` | Vertical px from a card's top where the marriage line runs. Person cards pin side handles here and the union dot sits at the same height, so the couple line stays horizontal even when card heights vary. |
| `COUPLE_GAP` | `:16` | `48` | Gap between two partners' cards (the marriage line spans it). |
| `SIBLING_GAP` | `:18` | `48` | Gap between adjacent sibling subtrees. |
| `RANK_GAP` | `:20` | `92` | Vertical gap between generations. |
| `ROOT_GAP` | `:22` | `120` | Gap between disconnected root subtrees. |

## Node and edge types

Defined at `src/lib/layout.ts:25`–`43`:

- `LinkState = "source" | "eligible" | "blocked"` (`:25`) — how a card participates
  in click-to-connect mode.
- `PersonNodeType` (`:26`) — a React Flow node carrying `{ person, linkState? }`.
- `UnionNodeType` (`:30`) — the junction dot node (no data).
- `FlowNode` (`:31`) — union of the two.
- `RelEdgeData` (`:34`) — edge payload: `kind: "couple" | "child"`, with `a`/`b`
  for couple partners, or `childId`/`parentIds` for child edges. Attached to every
  edge so clicks can resolve which relationship to remove.
- `FlowEdge` (`:43`) — `Edge<RelEdgeData>`.

## Edge rendering

- **Couple lines** are `straight`; solid for married pairs, dashed for
  co-parent-only relationships.
- **Child edges** are `step` (a shared horizontal segment forms the `---+---` bus
  between siblings); dashed and labeled "adopted" when any parent link is adoptive.
- The `linking` argument paints `linkState` on cards for click-to-connect mode.

## Rendering the graph

`buildFlow` output is consumed by `<ReactFlow>` in `TreeView`
(`src/app/tree/[treeId]/_tree/TreeView.tsx:39`), which registers `PersonNode` and
`UnionNode` (see [components.md](./components.md)) as the node renderers. The
optional `selectedId`/`linking` parameters drive focus-view and click-to-connect
highlighting.
