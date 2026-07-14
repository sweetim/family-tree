import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { FamilyData } from "../types";
import type { Person } from "../types";

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 220;
const UNION_SIZE = 12;

export type PersonNodeType = Node<{ person: Person }, "person">;
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
 * Classic genealogy layout:
 *
 *   father ──●── mother          couple joined by a horizontal line
 *            │                    through a "union" dot
 *       ┌────┴────┐
 *     son A     son B ──●── wife  children hang from a shared bus
 *                       │         below the union
 *                   daughter C
 *
 * Dagre computes ranks with the union as an intermediate node, then the
 * union dot is lifted onto the couple's own row, between the partners.
 */
export function buildFlow(
  people: FamilyData,
  selectedId?: string,
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

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const p of Object.values(people)) {
    g.setNode(p.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const [a, b] of couples.values()) {
    const u = unionId(a, b);
    g.setNode(u, { width: UNION_SIZE, height: UNION_SIZE });
    g.setEdge(a, u);
    g.setEdge(b, u);
  }
  for (const child of Object.values(people)) {
    const parents = child.parents.filter(l => people[l.id]);
    if (parents.length === 2) {
      g.setEdge(unionId(parents[0]!.id, parents[1]!.id), child.id);
    } else if (parents.length === 1) {
      g.setEdge(parents[0]!.id, child.id);
    }
  }

  dagre.layout(g);

  const nodes: FlowNode[] = [];

  for (const p of Object.values(people)) {
    const { x, y } = g.node(p.id);
    nodes.push({
      id: p.id,
      type: "person",
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      selected: p.id === selectedId,
      data: { person: p },
    });
  }

  // Lift each union dot onto the couple's row, centred between the partners,
  // so the marriage line runs horizontally card-to-card.
  const unionPos = new Map<string, { x: number; y: number }>();
  for (const [a, b] of couples.values()) {
    const pa = g.node(a);
    const pb = g.node(b);
    const pos = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    unionPos.set(unionId(a, b), pos);
    nodes.push({
      id: unionId(a, b),
      type: "union",
      position: { x: pos.x - UNION_SIZE / 2, y: pos.y - UNION_SIZE / 2 },
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
      const px = g.node(pid).x;
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
