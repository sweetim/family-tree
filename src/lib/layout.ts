import type { Edge, Node, SmoothStepPathOptions } from "@xyflow/react"
import {
  type FamilyData,
  isMarriedInSpouse,
  isRootFounder,
  maleLineIds,
  type Person,
} from "../types"
import { Z_INDEX } from "./z-index"

const NODE_WIDTH = 176
const NODE_HEIGHT = 220
/**
 * Vertical offset (px from a card's top) where the marriage line runs.
 * Person cards pin their side handles here and the union dot is placed at
 * the same height, so the couple line stays perfectly horizontal even
 * though rendered card heights vary.
 */
export const COUPLE_LINE_Y = 64
const UNION_SIZE = 12

/**
 * Where a parent→child "bus" bends, as a fraction from the union dot to the
 * child row's top. Card height varies with content (lifeline, birthplace,
 * cross-tree badges all add lines), but the union dot sits only
 * COUPLE_LINE_Y below its row's *assumed* top — a plain 0.5 midpoint can
 * land inside a taller-than-assumed card. The child row's top edge is
 * always exact regardless of content, so biasing the bend toward it keeps
 * the bus clear of real card bodies.
 */
const CHILD_BUS_POSITION = 0.85

/** Gap between two partners' cards — the marriage line spans it. */
const COUPLE_GAP = 48
/** Gap between adjacent sibling subtrees. */
const SIBLING_GAP = 48
/** Vertical gap between generations. */
const RANK_GAP = 92
/** Gap between disconnected root subtrees. */
const ROOT_GAP = 120
/** Width of the "Gen N" pill at the left edge of a generation row band. */
const GEN_LABEL_WIDTH = 64
/** Height of a generation row band — the full row pitch so stripes are contiguous. */
const BAND_HEIGHT = NODE_HEIGHT + RANK_GAP

/** How a card participates in click-to-connect mode. */
type LinkState = "source" | "eligible" | "blocked"
export type PersonNodeType = Node<
  {
    person: Person
    linkState?: LinkState
    marriedIn?: boolean
    rootFounder?: boolean
    maleLine?: boolean
  },
  "person"
>
export type UnionNodeType = Node<
  {
    date?: string
    a?: string
    b?: string
    statusType?: string
    divorceDate?: string
  },
  "union"
>
export type GenerationNodeType = Node<
  { generation: number; width: number; height: number; even: boolean },
  "generation"
>
export type FlowNode = PersonNodeType | UnionNodeType | GenerationNodeType

/** Attached to every edge so clicks can resolve which relationship to remove. */
export interface RelEdgeData extends Record<string, unknown> {
  kind: "couple" | "child"
  /** couple: the two partners */
  a?: string
  b?: string
  /** child: who hangs from this line and from whom */
  childId?: string
  parentIds?: string[]
  /** A connection between two members of the father-to-son male line. */
  maleLineConnection?: boolean
}
export type FlowEdge =
  | Edge<RelEdgeData, "straight">
  | (Edge<RelEdgeData, "smoothstep"> & { pathOptions?: SmoothStepPathOptions })

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

/**
 * Assigns every person a generation rank (row index, 0 = topmost).
 *
 * Partners must share a row, so people are first grouped into partner
 * components — one component is one row. The ranks then pin every parent
 * component exactly one row above its child components.
 *
 * That spacing has to survive a spouse with deeper ancestry: when a couple
 * is dragged down to sit beside one partner's deeper in-laws, the *other*
 * partner's own parents and siblings must follow them down, or they end up
 * stranded several rows too high (e.g. a wife's parents floating two rows
 * above her because her husband's side is one generation deeper). Two rules
 * applied to a fixpoint enforce the 1-row gap on every edge:
 *
 *   1. `child >= parent + 1` — longest-path floor, keeps a child below its
 *      parents.
 *   2. `parent >= child - 1` — a parent follows its deepest child down, so a
 *      bloodline slides with a member who married into a deeper family.
 *
 * Together they force `child == parent + 1` for every edge. Both rules only
 * ever raise ranks, so the loop converges; the pass bound guards against
 * malformed cyclic ancestry.
 */
function rankPeople(
  people: FamilyData,
  partnersOf: Map<string, string[]>,
): Map<string, number> {
  const ids = Object.keys(people)

  // Partner components: each is one row.
  const groupOf = new Map<string, number>()
  let groupCount = 0
  for (const id of ids) {
    if (groupOf.has(id)) continue
    const g = groupCount++
    const stack = [id]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (cur === undefined || groupOf.has(cur)) continue
      groupOf.set(cur, g)
      for (const n of partnersOf.get(cur) ?? [])
        if (!groupOf.has(n)) stack.push(n)
    }
  }

  // Deduped parent-group -> child-group edges. Self-edges and links whose
  // endpoints aren't in a group are dropped.
  const seenEdge = new Set<string>()
  const edges: Array<[number, number]> = []
  for (const p of Object.values(people)) {
    const cg = groupOf.get(p.id)
    if (cg === undefined) continue
    for (const link of p.parents) {
      const pg = groupOf.get(link.id)
      if (pg === undefined || pg === cg) continue
      const key = `${pg}:${cg}`
      if (seenEdge.has(key)) continue
      seenEdge.add(key)
      edges.push([pg, cg])
    }
  }

  // Fixpoint: child below parent (rule 1) and parent follows child (rule 2).
  const groupRank = new Array<number>(groupCount).fill(0)
  for (let pass = 0; pass < groupCount + 1; pass++) {
    let changed = false
    for (const [pg, cg] of edges) {
      const parentRank = groupRank[pg] ?? 0
      const childRank = groupRank[cg] ?? 0
      if (childRank < parentRank + 1) {
        groupRank[cg] = parentRank + 1
        changed = true
      }
      if (parentRank < childRank - 1) {
        groupRank[pg] = childRank - 1
        changed = true
      }
    }
    if (!changed) break
  }

  // Following children down can push ranks negative; renormalise so the top
  // row is 0.
  const min = groupRank.length > 0 ? Math.min(...groupRank) : 0
  const rank = new Map<string, number>()
  for (const id of ids)
    rank.set(id, (groupRank[groupOf.get(id) ?? 0] ?? 0) - min)
  return rank
}

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

  // Generation rank per person. Recursion depth alone is wrong: a rootless
  // couple reached only after their child was already placed (as someone
  // else's in-law) would sit at depth 0, floating far above the family they
  // married into. Ranks are solved globally instead — see {@link rankPeople}.
  const rank = rankPeople(people, partnersOf)

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

  const layoutGroup = (anchorId: string): Block => {
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
      if (!placed.has(c.id)) childBlocks.push(layoutGroup(c.id))
    }

    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COUPLE_GAP
    const kidsWidth =
      childBlocks.reduce((w, b) => w + b.width, 0)
      + Math.max(0, childBlocks.length - 1) * SIBLING_GAP
    const width = Math.max(rowWidth, kidsWidth)
    // Every member of the row shares a partner component, so one rank.
    const yCenter =
      (rank.get(anchorId) ?? 0) * (NODE_HEIGHT + RANK_GAP) + NODE_HEIGHT / 2

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
    if (!placed.has(p.id)) blocks.push(layoutGroup(p.id))
  }

  let x = 0
  for (const b of blocks) {
    b.place(x)
    x += b.width + ROOT_GAP
  }

  return pos
}

/** Couples joined on the canvas: married pairs, co-parents of any shared
 *  child, plus any pair with a recorded union (so a divorced couple stays
 *  connected by a dashed line instead of disappearing once it leaves
 *  `spouseIds`). */
function collectCouples(people: FamilyData): Map<string, [string, string]> {
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
  for (const p of Object.values(people)) {
    if (!p.unionStatus) continue
    for (const partnerId of Object.keys(p.unionStatus)) {
      if (!people[partnerId]) continue
      const key = pairKey(p.id, partnerId)
      couples.set(key, [p.id, partnerId].sort() as [string, string])
    }
  }
  return couples
}

export type TreeLayout = {
  couples: Map<string, [string, string]>
  positions: Map<string, { x: number; y: number }>
}

/**
 * Expensive, people-only layout: couple detection plus the recursive
 * positioner (which runs the generation-rank fixpoint). Memoize on `people`
 * alone so selecting a card or toggling click-to-connect never re-runs it.
 */
export function computeTreeLayout(people: FamilyData): TreeLayout {
  const couples = collectCouples(people)
  const positions = computePositions(people, couples)
  return { couples, positions }
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
  layout: TreeLayout,
  selectedId?: string,
  linking?: { sourceId: string; eligible: Set<string> },
  highlightBloodline = false,
  showGenerations = false,
  generationOffset = 1,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { couples } = layout
  const pos = layout.positions
  const maleLine = maleLineIds(people)

  const unionId = (a: string, b: string) => `u:${pairKey(a, b)}`

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
        marriedIn: isMarriedInSpouse(people, p.id),
        rootFounder: isRootFounder(people, p.id),
        maleLine: maleLine.has(p.id),
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
    const date = people[a]?.marriageDates[b] ?? people[b]?.marriageDates[a]
    const status = people[a]?.unionStatus?.[b] ?? people[b]?.unionStatus?.[a]
    nodes.push({
      id: unionId(a, b),
      type: "union",
      zIndex: Z_INDEX.unionNode,
      position: { x: dot.x - UNION_SIZE / 2, y: dot.y - UNION_SIZE / 2 },
      selectable: false,
      data: {
        a,
        b,
        date,
        statusType: status?.type,
        divorceDate: status?.type === "divorced" ? status.date : undefined,
      },
    })
  }

  // Generation row bands: a full-width zebra-striped highlight per
  // generation row, with the "Gen N" pill at its left edge. Distinct
  // y-centres are already one-per-generation (partners share a row), so
  // sorting them ascending yields rank order. The band spans the whole
  // content width so a row's generation is visible wherever you pan — no
  // scrolling to the left to find the label.
  if (showGenerations) {
    const rowYs = Array.from(
      new Set(
        Object.values(people)
          .map((person) => pos.get(person.id)?.y)
          .filter((y): y is number => y !== undefined),
      ),
    ).sort((a, b) => a - b)
    let leftEdgeX = Infinity
    let rightEdgeX = -Infinity
    for (const person of Object.values(people)) {
      const position = pos.get(person.id)
      if (!position) continue
      leftEdgeX = Math.min(leftEdgeX, position.x - NODE_WIDTH / 2)
      rightEdgeX = Math.max(rightEdgeX, position.x + NODE_WIDTH / 2)
    }
    if (Number.isFinite(leftEdgeX) && Number.isFinite(rightEdgeX)) {
      const bandLeft = leftEdgeX - GEN_LABEL_WIDTH - 24
      const bandWidth = rightEdgeX - bandLeft + 24
      rowYs.forEach((y, index) => {
        nodes.push({
          id: `gen:${index}`,
          type: "generation",
          selectable: false,
          deletable: false,
          draggable: false,
          zIndex: Z_INDEX.generationBand,
          position: { x: bandLeft, y: y - BAND_HEIGHT / 2 },
          data: {
            generation: index + generationOffset,
            width: bandWidth,
            height: BAND_HEIGHT,
            even: index % 2 === 0,
          },
        })
      })
    }
  }

  const edges: FlowEdge[] = []
  const coupleStroke = { stroke: "#94a3b8", strokeWidth: 2 }
  const maleLineStroke = { stroke: "#ef4444", strokeWidth: 4 }
  const selectedStroke = { stroke: "#3258f5", strokeWidth: 3 }
  const touchesSelected = (ids: (string | undefined)[]) =>
    selectedId !== undefined && ids.includes(selectedId)

  // Marriage / co-parent lines: partner → union dot, horizontal.
  for (const [a, b] of couples.values()) {
    const u = unionId(a, b)
    const ux = unionPos.get(u)?.x
    const married =
      people[a]?.spouseIds.includes(b) || people[b]?.spouseIds.includes(a)
    const coupleBase = married
      ? coupleStroke
      : { ...coupleStroke, strokeDasharray: "6 4" }
    const highlightCouple = touchesSelected([a, b])
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
        animated: highlightCouple,
        zIndex: highlightCouple ? Z_INDEX.edgeSelected : undefined,
        style: highlightCouple
          ? { ...coupleBase, ...selectedStroke }
          : coupleBase,
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
    const childBase = adopted
      ? { ...coupleStroke, strokeDasharray: "4 4" }
      : coupleStroke
    const highlightChild = touchesSelected([
      child.id,
      ...parents.map((l) => l.id),
    ])
    const maleLineConnection =
      maleLine.has(child.id)
      && parents.some(
        (parent) =>
          people[parent.id]?.gender === "male" && maleLine.has(parent.id),
      )
    const highlightMaleLineConnection = highlightBloodline && maleLineConnection
    edges.push({
      id: `pc:${source}:${child.id}`,
      source,
      sourceHandle: "b",
      target: child.id,
      targetHandle: "t",
      type: "smoothstep",
      pathOptions: { borderRadius: 0, stepPosition: CHILD_BUS_POSITION },
      animated: highlightChild,
      zIndex: highlightChild
        ? Z_INDEX.edgeSelected
        : highlightMaleLineConnection
          ? Z_INDEX.edgeMaleLine
          : undefined,
      style: highlightChild
        ? { ...childBase, ...selectedStroke }
        : highlightMaleLineConnection
          ? { ...childBase, ...maleLineStroke }
          : childBase,
      ...(adopted && {
        label: "adopted",
        labelStyle: { fill: "#64748b", fontSize: 10 },
        labelBgStyle: { fill: "#f8fafc" },
      }),
      data: {
        kind: "child",
        childId: child.id,
        parentIds: parents.map((l) => l.id),
        maleLineConnection,
      },
    })
  }

  return { nodes, edges }
}

/** A top-level ancestral line: a rootless person, or a married/co-parent couple. */
type FamilyRoot = {
  /** Rootless people forming this line — one person, or a couple. */
  heads: string[]
  /** Head whose blood line is shown when this root is expanded. */
  representative: string
}

/**
 * Finds the top-level ancestral lines of a family: people with no visible
 * parents, grouped into couples by marriage or a shared child. Each group is
 * one collapsible root. The representative (earliest-added head) drives the
 * expanded view.
 */
export function findRoots(people: FamilyData): FamilyRoot[] {
  const order = new Map(Object.keys(people).map((id, i) => [id, i]))
  const hasVisibleParents = (id: string) =>
    (people[id]?.parents ?? []).some((l) => people[l.id])
  const rootlessIds = Object.values(people)
    .filter((p) => !hasVisibleParents(p.id))
    .map((p) => p.id)
  const rootSet = new Set(rootlessIds)

  // Adjacency among rootless people only: marriages + shared-child co-parents.
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!rootSet.has(a) || !rootSet.has(b) || a === b) return
    let sa = adj.get(a)
    if (!sa) {
      sa = new Set()
      adj.set(a, sa)
    }
    sa.add(b)
    let sb = adj.get(b)
    if (!sb) {
      sb = new Set()
      adj.set(b, sb)
    }
    sb.add(a)
  }
  for (const id of rootlessIds) {
    const p = people[id]
    if (!p) continue
    for (const sid of p.spouseIds) link(id, sid)
  }
  for (const child of Object.values(people)) {
    const parents = child.parents
      .filter((l) => rootSet.has(l.id))
      .map((l) => l.id)
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const a = parents[i]
        const b = parents[j]
        if (a && b) link(a, b)
      }
    }
  }

  // Components among rootless people = root groups (couples).
  const seen = new Set<string>()
  const groups: string[][] = []
  for (const id of rootlessIds) {
    if (seen.has(id)) continue
    const group: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (cur === undefined || seen.has(cur)) continue
      seen.add(cur)
      group.push(cur)
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n)
    }
    group.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    groups.push(group)
  }
  groups.sort(
    (a, b) => (order.get(a[0] ?? "") ?? 0) - (order.get(b[0] ?? "") ?? 0),
  )

  return groups.map((heads) => ({
    heads,
    representative: heads[0] ?? "",
  }))
}
