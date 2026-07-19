import { describe, expect, test } from "bun:test";
import type { TreeEdges } from "./types";

/** Minimal in-memory Storage so the store (which reads localStorage at load) works under Bun. */
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

// IMPORTANT: the migration test runs first. The store builds its graph once,
// on first import, so the legacy keys must be in place before that import.
describe("store migration", () => {
  test("migrates legacy per-tree data into a single global graph", async () => {
    const ls = makeLocalStorage();
    ls.setItem("family-trees-index", JSON.stringify([{ id: "ho", name: "Ho Family", createdAt: "x" }]));
    ls.setItem("family-tree-v2:ho", JSON.stringify({
      tim: { id: "tim", name: "Tim", parents: [], spouseIds: ["yumi"] },
      yumi: { id: "yumi", name: "Yumi", parents: [], spouseIds: ["tim"] },
    }));
    (globalThis as unknown as { localStorage: Storage }).localStorage = ls;

    const { countMembers } = await import("./store");

    const graph = JSON.parse(ls.getItem("family-graph-v1")!);
    expect(graph.index[0].id).toBe("ho");
    expect(graph.trees.ho.members.sort()).toEqual(["tim", "yumi"]);
    expect(graph.trees.ho.spouses).toEqual([["tim", "yumi"]]);
    expect(graph.persons.tim.name).toBe("Tim");
    expect(countMembers("ho")).toBe(2);
  });
});

describe("store helpers", () => {
  test("normalizeImport converts v1 and passes v2 through", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
    const { normalizeImport } = await import("./store");

    const v1 = {
      a: { id: "a", name: "A", parentIds: ["p"], spouseId: "b" },
      b: { id: "b", name: "B" },
      p: { id: "p", name: "P" },
    };
    expect(normalizeImport(v1).a!.parents).toEqual([{ id: "p" }]);
    expect(normalizeImport(v1).a!.spouseIds).toEqual(["b"]);

    const v2 = { a: { id: "a", name: "A", parents: [{ id: "p" }], spouseIds: ["b"] } };
    expect(normalizeImport(v2)).toEqual(v2);
  });

  test("seedData yields members, spouses, and parent edges", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
    const { seedData } = await import("./store");
    const seed = seedData();
    expect(seed.edges.members).toHaveLength(5);
    expect(seed.edges.spouses.length).toBeGreaterThan(0);
    expect(Object.keys(seed.edges.parents)).toHaveLength(2);
  });

  test("rewriteEdges remaps a dropped id onto the kept id, deduping edges", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
    const { rewriteEdges } = await import("./store");

    const e: TreeEdges = {
      members: ["tim", "y2", "keeps"],
      spouses: [["tim", "y2"], ["keeps", "y2"]],
      parents: { y2: [{ id: "p1" }], keeps: [{ id: "p1" }, { id: "y2" }] },
    };
    const r = rewriteEdges(e, "y1", "y2");

    expect(r.members).toEqual(["tim", "y1", "keeps"]);
    expect(r.spouses).toEqual([["tim", "y1"], ["keeps", "y1"]]);
    expect(Object.keys(r.parents).sort()).toEqual(["keeps", "y1"]);
    expect(r.parents["y1"]!.map(l => l.id)).toEqual(["p1"]);
    expect(r.parents.keeps!.map(l => l.id)).toEqual(["p1", "y1"]);
  });

  test("rewriteEdges drops self-links and caps parents at two", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
    const { rewriteEdges } = await import("./store");

    const e: TreeEdges = {
      members: ["a", "b"],
      spouses: [["a", "b"]],
      parents: { a: [{ id: "b" }, { id: "c" }, { id: "d" }] },
    };
    const r = rewriteEdges(e, "a", "b");

    // a married b, both collapse to a -> self-pair dropped
    expect(r.spouses).toEqual([]);
    // a's parents included b (now self -> dropped), leaving c, d (capped at 2)
    expect(r.parents.a!.map(l => l.id)).toEqual(["c", "d"]);
  });

  test("propagateSurvivor mirrors a person's relatives into every tree they belong to", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
    const { propagateSurvivor } = await import("./store");

    const trees: Record<string, TreeEdges> = {
      ho: { members: ["tim", "yumi"], spouses: [["tim", "yumi"]], parents: {} },
      hayashi: {
        members: ["yumi", "p1", "p2", "c1"],
        spouses: [],
        parents: { yumi: [{ id: "p1" }, { id: "p2" }], c1: [{ id: "yumi" }] },
      },
    };
    propagateSurvivor(trees, "yumi");

    const ho = trees.ho!;
    expect([...ho.members].sort()).toEqual(["c1", "p1", "p2", "tim", "yumi"]);
    const pairs = (s: [string, string][]) => s.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)).sort();
    expect(pairs(ho.spouses)).toEqual(["tim,yumi"]);
    expect(ho.parents.yumi!.map(l => l.id).sort()).toEqual(["p1", "p2"]);
    expect(ho.parents.c1!.map(l => l.id)).toEqual(["yumi"]);

    const hayashi = trees.hayashi!;
    expect(hayashi.members.includes("tim")).toBe(true);
    expect(pairs(hayashi.spouses)).toEqual(["tim,yumi"]);
  });
});
