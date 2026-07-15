import { describe, expect, test } from "bun:test";

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
});
