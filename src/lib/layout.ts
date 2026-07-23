import type { Edge, Node } from "@xyflow/react"
import type { FamilyData, Person } from "../types"

export const NODE_WIDTH = 176
export const NODE_HEIGHT = 220
/**
 * Vertical offset (px from a card's top) where the marriage line runs.
 * Person cards pin their side handles here and the union dot is placed at
 * the same height, so the couple line stays perfectly horizontal even
 * though rendered card heights vary.
 */
export const COUPLE_LINE_Y = 64
const UNION_SIZE = 12

/** Gap between two partners' cards — the marriage line spans it. */
const COUPLE_GAP = 48
/** Gap between adjacent sibling subtrees. */
const SIBLING_GAP = 48
/** Vertical gap between generations. */
const RANK_GAP = 92
/** Gap between disconnected root subtrees. */
const ROOT_GAP = 120

/** How a card participates in click-to-connect mode. */
export type LinkState = "source" | "eligible" | "blocked"
export type PersonNodeType = Node<
  {
    person: Person
    linkState?: LinkState
    /** A collapsed family root in single-root mode — click to expand. */
    collapsedRoot?: boolean
    /** People hidden behind a collapsed root card. */
    collapsedCount?: number
  },
  "person"
>
export type UnionNodeType = Node<Record<string, never>, "union">
export type FlowNode = PersonNodeType | UnionNodeType

/** Attached to every edge so clicks can resolve which relationship to remove. */
export interface RelEdgeData extends Record<string, unknown> {
  kind: "couple" | "child"
  /** couple: the two partners */
  a?: string
  b?: string
  /** child: who hangs from this line and from whom */
  childId?: string
  parentIds?: string[]
}
export type FlowEdge = Edge<RelEdgeData>

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

/**
 * Genealogy-specific layout. Dagre-style generic layering reorders people
 * within a generation to minimise crossings, which breaks two invariants a
 * family chart needs: partners must sit side by side (the marriage line is
 * drawn straight between them) and siblings must appear in birth order.
 *
 * Instead we lay the tree out recursively: each subtree is a "couple row"
 * (a person plus their partners, chained left-to-right) with the children
 * of each union hanging below in birth order, centred under their parents.
 * A subtree's width is max(row, children), so siblings never overlap.
 */
function computePositions(
  people: FamilyData,
  couples: Map<string, [string, string]>,
): Map<string, { x: number; y: number }> {
  /** Centre positions for each person's card. */
  const pos = new Map<string, { x: number; y: number }>()
  const insertionOrder = new Map(Object.keys(people).map((id, i) => [id, i]))

  // Partner adjacency: spouses first (in the order they were married in),
  // then unmarried co-parents.
  const partnersOf = new Map<string, string[]>()
  const addPartner = (a: string, b: string) => {
    const list = partnersOf.get(a) ?? []
    if (!list.includes(b)) list.push(b)
    partnersOf.set(a, list)
  }
  for (const p of Object.values(people)) {
    for (const sid of p.spouseIds) if (people[sid]) addPartner(p.id, sid)
  }
  for (const [a, b] of couples.values()) {
    addPartner(a, b)
    addPartner(b, a)
  }

  // Eldest first; people without a birth date keep the order they were added.
  const byBirth = (a: Person, b: Person) => {
    if (a.dob && b.dob && a.dob !== b.dob) return a.dob < b.dob ? -1 : 1
    return (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0)
  }

  // Children grouped by the unit they hang from: pairKey for two visible
  // parents, the lone parent's id otherwise.
  const childrenByUnit = new Map<string, Person[]>()
  for (const child of Object.values(people)) {
    const parents = child.parents.filter((l) => people[l.id])
    if (parents.length === 0) continue
    const [first, second] = parents
    const key =
      parents.length === 2 && first && second
        ? pairKey(first.id, second.id)
        : (first?.id ?? "")
    const list = childrenByUnit.get(key) ?? []
    list.push(child)
    childrenByUnit.set(key, list)
  }
  for (const list of childrenByUnit.values()) list.sort(byBirth)

  const placed = new Set<string>()

  interface Block {
    width: number
    place: (x: number) => void
  }

  const layoutGroup = (anchorId: string, depth: number): Block => {
    // The couple row: the anchor plus chains of not-yet-placed partners
    // extending right, then left (so a second marriage sits on the other
    // side of the anchor and every union spans an adjacent gap).
    const row = [anchorId]
    placed.add(anchorId)
    const extend = (push: (id: string) => void, start: string) => {
      for (let end = start; ; ) {
        const next = (partnersOf.get(end) ?? []).find((id) => !placed.has(id))
        if (!next) break
        placed.add(next)
        push(next)
        end = next
      }
    }
    extend((id) => row.push(id), anchorId)
    extend((id) => row.unshift(id), anchorId)

    // Husband-left convention for a simple couple.
    if (row.length === 2) {
      const [a, b] = row
      if (
        a !== undefined
        && b !== undefined
        && people[a]?.gender === "female"
        && people[b]?.gender === "male"
      ) {
        row.reverse()
      }
    }

    // Children, left to right: walk the row, taking each member's
    // single-parent children and each adjacent gap's union children.
    const kids: Person[] = []
    const seen = new Set<string>()
    const take = (key: string) => {
      for (const c of childrenByUnit.get(key) ?? []) {
        if (!seen.has(c.id)) {
          seen.add(c.id)
          kids.push(c)
        }
      }
    }
    for (let i = 0; i < row.length; i++) {
      const a = row[i]
      if (a === undefined) continue
      take(a)
      const b = row[i + 1]
      if (b !== undefined) take(pairKey(a, b))
    }
    // Unions whose partners ended up non-adjacent (3+ marriages) still get
    // their children placed here rather than dropped.
    for (const id of row) {
      for (const q of partnersOf.get(id) ?? []) {
        if (row.includes(q)) take(pairKey(id, q))
      }
    }

    const childBlocks: Block[] = []
    for (const c of kids) {
      if (!placed.has(c.id)) childBlocks.push(layoutGroup(c.id, depth + 1))
    }

    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COUPLE_GAP
    const kidsWidth =
      childBlocks.reduce((w, b) => w + b.width, 0)
      + Math.max(0, childBlocks.length - 1) * SIBLING_GAP
    const width = Math.max(rowWidth, kidsWidth)
    const yCenter = depth * (NODE_HEIGHT + RANK_GAP) + NODE_HEIGHT / 2

    return {
      width,
      place: (x0: number) => {
        let x = x0 + (width - rowWidth) / 2 + NODE_WIDTH / 2
        for (const id of row) {
          pos.set(id, { x, y: yCenter })
          x += NODE_WIDTH + COUPLE_GAP
        }
        let cx = x0 + (width - kidsWidth) / 2
        for (const b of childBlocks) {
          b.place(cx)
          cx += b.width + SIBLING_GAP
        }
      },
    }
  }

  // Roots: people with no parents in view. Prefer anchors whose partners
  // also have no parents, so a married-in spouse never becomes the root of
  // a subtree their partner's parents should own.
  const everyone = Object.values(people)
  const hasVisibleParents = (p: Person) => p.parents.some((l) => people[l.id])
  const rootless = everyone.filter((p) => !hasVisibleParents(p))
  const anchors = rootless.filter(
    (p) =>
      !(partnersOf.get(p.id) ?? []).some((sid) => {
        const partner = people[sid]
        return partner !== undefined && hasVisibleParents(partner)
      }),
  )

  const blocks: Block[] = []
  for (const p of [...anchors, ...rootless, ...everyone]) {
    if (!placed.has(p.id)) blocks.push(layoutGroup(p.id, 0))
  }

  let x = 0
  for (const b of blocks) {
    b.place(x)
    x += b.width + ROOT_GAP
  }

  return pos
}

/**
 * Classic genealogy layout:
 *
 *   father ──●── mother          couple joined by a horizontal line
 *            │                    through a "union" dot
 *       ┌────┴────┐
 *     son A     son B ──●── wife  children hang from a shared bus
 *                       │         below the union
 *                   daughter C
 *
 * Siblings run eldest → youngest left to right; partners are always
 * adjacent so the marriage line never crosses another card.
 */
export function buildFlow(
  people: FamilyData,
  selectedId?: string,
  linking?: { sourceId: string; eligible: Set<string> },
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  // Collect couples: married pairs plus co-parents of any child.
  const couples = new Map<string, [string, string]>()
  for (const p of Object.values(people)) {
    for (const sid of p.spouseIds) {
      if (people[sid])
        couples.set(pairKey(p.id, sid), [p.id, sid].sort() as [string, string])
    }
  }
  for (const child of Object.values(people)) {
    const parents = child.parents.filter((l) => people[l.id])
    if (parents.length === 2) {
      const [first, second] = parents
      if (first && second) {
        couples.set(
          pairKey(first.id, second.id),
          [first.id, second.id].sort() as [string, string],
        )
      }
    }
  }

  const unionId = (a: string, b: string) => `u:${pairKey(a, b)}`

  const pos = computePositions(people, couples)

  const nodes: FlowNode[] = []

  for (const p of Object.values(people)) {
    const position = pos.get(p.id)
    if (!position) continue
    const { x, y } = position
    nodes.push({
      id: p.id,
      type: "person",
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      selected: p.id === selectedId,
      data: {
        person: p,
        linkState: linking
          ? p.id === linking.sourceId
            ? "source"
            : linking.eligible.has(p.id)
              ? "eligible"
              : "blocked"
          : undefined,
      },
    })
  }

  // The union dot sits on the couple's row, centred between the partners,
  // so the marriage line runs horizontally card-to-card.
  const unionPos = new Map<string, { x: number; y: number }>()
  for (const [a, b] of couples.values()) {
    const pa = pos.get(a)
    const pb = pos.get(b)
    if (!pa || !pb) continue
    const rowTop = (pa.y + pb.y) / 2 - NODE_HEIGHT / 2
    const dot = { x: (pa.x + pb.x) / 2, y: rowTop + COUPLE_LINE_Y }
    unionPos.set(unionId(a, b), dot)
    nodes.push({
      id: unionId(a, b),
      type: "union",
      position: { x: dot.x - UNION_SIZE / 2, y: dot.y - UNION_SIZE / 2 },
      selectable: false,
      data: {},
    })
  }

  const edges: FlowEdge[] = []
  const coupleStroke = { stroke: "#94a3b8", strokeWidth: 2 }

  // Marriage / co-parent lines: partner → union dot, horizontal.
  for (const [a, b] of couples.values()) {
    const u = unionId(a, b)
    const ux = unionPos.get(u)?.x
    const married =
      people[a]?.spouseIds.includes(b) || people[b]?.spouseIds.includes(a)
    for (const pid of [a, b]) {
      const px = pos.get(pid)?.x
      if (px === undefined || ux === undefined) continue
      edges.push({
        id: `couple:${u}:${pid}`,
        source: pid,
        sourceHandle: px <= ux ? "r" : "l",
        target: u,
        targetHandle: px <= ux ? "l" : "r",
        type: "straight",
        style: married
          ? coupleStroke
          : { ...coupleStroke, strokeDasharray: "6 4" },
        data: { kind: "couple", a, b },
      })
    }
  }

  // Parent → child edges. Step edges from the same union share their
  // horizontal segment, which forms the ---+--- bus of a classic chart.
  for (const child of Object.values(people)) {
    const parents = child.parents.filter((l) => people[l.id])
    if (parents.length === 0) continue
    const adopted = parents.some((l) => l.adopted)
    const [first, second] = parents
    if (!first) continue
    const source =
      parents.length === 2 && second ? unionId(first.id, second.id) : first.id
    edges.push({
      id: `pc:${source}:${child.id}`,
      source,
      sourceHandle: "b",
      target: child.id,
      targetHandle: "t",
      type: "step",
      style: adopted
        ? { ...coupleStroke, strokeDasharray: "4 4" }
        : coupleStroke,
      ...(adopted && {
        label: "adopted",
        labelStyle: { fill: "#64748b", fontSize: 10 },
        labelBgStyle: { fill: "#f8fafc" },
      }),
      data: {
        kind: "child",
        childId: child.id,
        parentIds: parents.map((l) => l.id),
      },
    })
  }

  return { nodes, edges }
}

/** A connected component of a family with a representative root person. */
export type FamilyRoot = {
  /** Anchor person id — the card shown when this root is collapsed. */
  id: string
  /** Every person in this disconnected family. */
  members: Set<string>
}

/**
 * Splits a family into its disconnected components (roots) and picks an
 * anchor for each. The anchor preference mirrors {@link computePositions}:
 * a rootless person whose partners are also rootless, else any rootless
 * person, else the earliest-added member.
 */
export function findRoots(people: FamilyData): FamilyRoot[] {
  const ids = Object.keys(people)
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    if (!people[a] || !people[b] || a === b) return
    let la = adj.get(a)
    if (!la) {
      la = []
      adj.set(a, la)
    }
    la.push(b)
    let lb = adj.get(b)
    if (!lb) {
      lb = []
      adj.set(b, lb)
    }
    lb.push(a)
  }
  for (const p of Object.values(people)) {
    for (const sid of p.spouseIds) link(p.id, sid)
    for (const parent of p.parents) link(p.id, parent.id)
    // Co-parents of a shared child are partners in the same couple unit.
    const parents = p.parents.filter((l) => people[l.id])
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const a = parents[i]
        const b = parents[j]
        if (a && b) link(a.id, b.id)
      }
    }
  }

  const order = new Map(ids.map((id, i) => [id, i]))
  const hasVisibleParents = (id: string) =>
    (people[id]?.parents ?? []).some((l) => people[l.id])
  const partnersOf = (id: string) => adj.get(id) ?? []
  const pickAnchor = (members: string[], fallback: string): string => {
    const sorted = [...members].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    )
    return (
      sorted.find(
        (id) =>
          !hasVisibleParents(id)
          && partnersOf(id).every((pid) => !hasVisibleParents(pid)),
      )
      ?? sorted.find((id) => !hasVisibleParents(id))
      ?? sorted[0]
      ?? fallback
    )
  }

  const seen = new Set<string>()
  const roots: FamilyRoot[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const component: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (cur === undefined || seen.has(cur)) continue
      seen.add(cur)
      component.push(cur)
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n)
    }
    roots.push({ id: pickAnchor(component, id), members: new Set(component) })
  }
  roots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return roots
}

/**
 * Lays the collapsed family-root cards in a centered row above the expanded
 * family. Only used in single-root mode; the active family comes in via
 * {@link buildFlow}, the rest arrive here as single anchor cards.
 */
export function withCollapsedRoots(
  flow: { nodes: FlowNode[]; edges: FlowEdge[] },
  collapsed: FamilyRoot[],
  people: FamilyData,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (collapsed.length === 0) return flow

  const personNodes = flow.nodes.filter(
    (n): n is PersonNodeType => n.type === "person",
  )
  const lefts = personNodes.map((n) => n.position.x)
  const rights = personNodes.map((n) => n.position.x + NODE_WIDTH)
  const tops = personNodes.map((n) => n.position.y)

  const minX = lefts.length > 0 ? Math.min(...lefts) : 0
  const maxX = rights.length > 0 ? Math.max(...rights) : 0
  const topY = tops.length > 0 ? Math.min(...tops) : 0
  const centerX = (minX + maxX) / 2
  const rowY = topY - NODE_HEIGHT - ROOT_GAP

  const total =
    collapsed.length * NODE_WIDTH + (collapsed.length - 1) * ROOT_GAP
  const startX = centerX - total / 2

  const extra: FlowNode[] = []
  let slot = 0
  for (const root of collapsed) {
    const person = people[root.id]
    if (!person) continue
    const center = startX + slot * (NODE_WIDTH + ROOT_GAP) + NODE_WIDTH / 2
    slot += 1
    extra.push({
      id: root.id,
      type: "person",
      position: { x: center - NODE_WIDTH / 2, y: rowY },
      data: {
        person,
        collapsedRoot: true,
        collapsedCount: Math.max(0, root.members.size - 1),
      },
    })
  }

  return { nodes: [...flow.nodes, ...extra], edges: flow.edges }
}
