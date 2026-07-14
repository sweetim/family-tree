import type { Edge, Node } from "@xyflow/react";
import type { FamilyData } from "../types";
import type { Person } from "../types";

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 220;
/**
 * Vertical offset (px from a card's top) where the marriage line runs.
 * Person cards pin their side handles here and the union dot is placed at
 * the same height, so the couple line stays perfectly horizontal even
 * though rendered card heights vary.
 */
export const COUPLE_LINE_Y = 64;
const UNION_SIZE = 12;

/** Gap between two partners' cards — the marriage line spans it. */
const COUPLE_GAP = 48;
/** Gap between adjacent sibling subtrees. */
const SIBLING_GAP = 48;
/** Vertical gap between generations. */
const RANK_GAP = 92;
/** Gap between disconnected root subtrees. */
const ROOT_GAP = 120;

/** How a card participates in click-to-connect mode. */
export type LinkState = "source" | "eligible" | "blocked";
export type PersonNodeType = Node<{ person: Person; linkState?: LinkState }, "person">;
export type UnionNodeType = Node<Record<string, never>, "union">;
export type FlowNode = PersonNodeType | UnionNodeType;

/** Attached to every edge so clicks can resolve which relationship to remove. */
export interface RelEdgeData extends Record<string, unknown> {
  kind: "couple" | "child";
  /** couple: the two partners */
  a?: string;
  b?: string;
  /** child: who hangs from this line and from whom */
  childId?: string;
  parentIds?: string[];
}
export type FlowEdge = Edge<RelEdgeData>;

const pairKey = (a: string, b: string) => [a, b].sort().join(":");

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
  const pos = new Map<string, { x: number; y: number }>();
  const insertionOrder = new Map(Object.keys(people).map((id, i) => [id, i]));

  // Partner adjacency: spouses first (in the order they were married in),
  // then unmarried co-parents.
  const partnersOf = new Map<string, string[]>();
  const addPartner = (a: string, b: string) => {
    const list = partnersOf.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    partnersOf.set(a, list);
  };
  for (const p of Object.values(people)) {
    for (const sid of p.spouseIds) if (people[sid]) addPartner(p.id, sid);
  }
  for (const [a, b] of couples.values()) {
    addPartner(a, b);
    addPartner(b, a);
  }

  // Eldest first; people without a birth date keep the order they were added.
  const byBirth = (a: Person, b: Person) => {
    if (a.dob && b.dob && a.dob !== b.dob) return a.dob < b.dob ? -1 : 1;
    return insertionOrder.get(a.id)! - insertionOrder.get(b.id)!;
  };

  // Children grouped by the unit they hang from: pairKey for two visible
  // parents, the lone parent's id otherwise.
  const childrenByUnit = new Map<string, Person[]>();
  for (const child of Object.values(people)) {
    const parents = child.parents.filter(l => people[l.id]);
    if (parents.length === 0) continue;
    const key = parents.length === 2 ? pairKey(parents[0]!.id, parents[1]!.id) : parents[0]!.id;
    const list = childrenByUnit.get(key) ?? [];
    list.push(child);
    childrenByUnit.set(key, list);
  }
  for (const list of childrenByUnit.values()) list.sort(byBirth);

  const placed = new Set<string>();

  interface Block {
    width: number;
    place: (x: number) => void;
  }

  const layoutGroup = (anchorId: string, depth: number): Block => {
    // The couple row: the anchor plus chains of not-yet-placed partners
    // extending right, then left (so a second marriage sits on the other
    // side of the anchor and every union spans an adjacent gap).
    const row = [anchorId];
    placed.add(anchorId);
    const extend = (push: (id: string) => void, start: string) => {
      for (let end = start; ; ) {
        const next = (partnersOf.get(end) ?? []).find(id => !placed.has(id));
        if (!next) break;
        placed.add(next);
        push(next);
        end = next;
      }
    };
    extend(id => row.push(id), anchorId);
    extend(id => row.unshift(id), anchorId);

    // Husband-left convention for a simple couple.
    if (row.length === 2 && people[row[0]!]!.gender === "female" && people[row[1]!]!.gender === "male") {
      row.reverse();
    }

    // Children, left to right: walk the row, taking each member's
    // single-parent children and each adjacent gap's union children.
    const kids: Person[] = [];
    const seen = new Set<string>();
    const take = (key: string) => {
      for (const c of childrenByUnit.get(key) ?? []) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          kids.push(c);
        }
      }
    };
    for (let i = 0; i < row.length; i++) {
      take(row[i]!);
      if (i + 1 < row.length) take(pairKey(row[i]!, row[i + 1]!));
    }
    // Unions whose partners ended up non-adjacent (3+ marriages) still get
    // their children placed here rather than dropped.
    for (const id of row) {
      for (const q of partnersOf.get(id) ?? []) {
        if (row.includes(q)) take(pairKey(id, q));
      }
    }

    const childBlocks: Block[] = [];
    for (const c of kids) {
      if (!placed.has(c.id)) childBlocks.push(layoutGroup(c.id, depth + 1));
    }

    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COUPLE_GAP;
    const kidsWidth =
      childBlocks.reduce((w, b) => w + b.width, 0) + Math.max(0, childBlocks.length - 1) * SIBLING_GAP;
    const width = Math.max(rowWidth, kidsWidth);
    const yCenter = depth * (NODE_HEIGHT + RANK_GAP) + NODE_HEIGHT / 2;

    return {
      width,
      place: (x0: number) => {
        let x = x0 + (width - rowWidth) / 2 + NODE_WIDTH / 2;
        for (const id of row) {
          pos.set(id, { x, y: yCenter });
          x += NODE_WIDTH + COUPLE_GAP;
        }
        let cx = x0 + (width - kidsWidth) / 2;
        for (const b of childBlocks) {
          b.place(cx);
          cx += b.width + SIBLING_GAP;
        }
      },
    };
  };

  // Roots: people with no parents in view. Prefer anchors whose partners
  // also have no parents, so a married-in spouse never becomes the root of
  // a subtree their partner's parents should own.
  const everyone = Object.values(people);
  const hasVisibleParents = (p: Person) => p.parents.some(l => people[l.id]);
  const rootless = everyone.filter(p => !hasVisibleParents(p));
  const anchors = rootless.filter(
    p => !(partnersOf.get(p.id) ?? []).some(sid => hasVisibleParents(people[sid]!)),
  );

  const blocks: Block[] = [];
  for (const p of [...anchors, ...rootless, ...everyone]) {
    if (!placed.has(p.id)) blocks.push(layoutGroup(p.id, 0));
  }

  let x = 0;
  for (const b of blocks) {
    b.place(x);
    x += b.width + ROOT_GAP;
  }

  return pos;
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
  const couples = new Map<string, [string, string]>();
  for (const p of Object.values(people)) {
    for (const sid of p.spouseIds) {
      if (people[sid]) couples.set(pairKey(p.id, sid), [p.id, sid].sort() as [string, string]);
    }
  }
  for (const child of Object.values(people)) {
    const parents = child.parents.filter(l => people[l.id]);
    if (parents.length === 2) {
      couples.set(pairKey(parents[0]!.id, parents[1]!.id), [parents[0]!.id, parents[1]!.id].sort() as [string, string]);
    }
  }

  const unionId = (a: string, b: string) => `u:${pairKey(a, b)}`;

  const pos = computePositions(people, couples);

  const nodes: FlowNode[] = [];

  for (const p of Object.values(people)) {
    const { x, y } = pos.get(p.id)!;
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
    });
  }

  // The union dot sits on the couple's row, centred between the partners,
  // so the marriage line runs horizontally card-to-card.
  const unionPos = new Map<string, { x: number; y: number }>();
  for (const [a, b] of couples.values()) {
    const pa = pos.get(a)!;
    const pb = pos.get(b)!;
    const rowTop = (pa.y + pb.y) / 2 - NODE_HEIGHT / 2;
    const dot = { x: (pa.x + pb.x) / 2, y: rowTop + COUPLE_LINE_Y };
    unionPos.set(unionId(a, b), dot);
    nodes.push({
      id: unionId(a, b),
      type: "union",
      position: { x: dot.x - UNION_SIZE / 2, y: dot.y - UNION_SIZE / 2 },
      selectable: false,
      data: {},
    });
  }

  const edges: FlowEdge[] = [];
  const coupleStroke = { stroke: "#94a3b8", strokeWidth: 2 };

  // Marriage / co-parent lines: partner → union dot, horizontal.
  for (const [a, b] of couples.values()) {
    const u = unionId(a, b);
    const ux = unionPos.get(u)!.x;
    const married =
      people[a]!.spouseIds.includes(b) || people[b]!.spouseIds.includes(a);
    for (const pid of [a, b]) {
      const px = pos.get(pid)!.x;
      edges.push({
        id: `couple:${u}:${pid}`,
        source: pid,
        sourceHandle: px <= ux ? "r" : "l",
        target: u,
        targetHandle: px <= ux ? "l" : "r",
        type: "straight",
        style: married ? coupleStroke : { ...coupleStroke, strokeDasharray: "6 4" },
        data: { kind: "couple", a, b },
      });
    }
  }

  // Parent → child edges. Step edges from the same union share their
  // horizontal segment, which forms the ---+--- bus of a classic chart.
  for (const child of Object.values(people)) {
    const parents = child.parents.filter(l => people[l.id]);
    if (parents.length === 0) continue;
    const adopted = parents.some(l => l.adopted);
    const source =
      parents.length === 2 ? unionId(parents[0]!.id, parents[1]!.id) : parents[0]!.id;
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
      data: { kind: "child", childId: child.id, parentIds: parents.map(l => l.id) },
    });
  }

  return { nodes, edges };
}
