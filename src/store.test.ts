import { describe, expect, test } from "bun:test"
import type { GlobalState } from "./store"
import type { TreeEdges } from "./types"

describe("store helpers", () => {
  test("normalizeImport converts v1 and passes v2 through", async () => {
    const { normalizeImport } = await import("./store")

    const v1 = {
      a: { id: "a", name: "A", parentIds: ["p"], spouseId: "b" },
      b: { id: "b", name: "B" },
      p: { id: "p", name: "P" },
    }
    expect(normalizeImport(v1).a?.parents).toEqual([{ id: "p" }])
    expect(normalizeImport(v1).a?.spouseIds).toEqual(["b"])

    const v2 = {
      a: { id: "a", name: "A", parents: [{ id: "p" }], spouseIds: ["b"] },
    }
    expect(normalizeImport(v2)).toEqual(v2)
  })

  test("seedData yields members, spouses, and parent edges", async () => {
    const { seedData } = await import("./store")
    const seed = seedData()
    expect(seed.edges.members).toHaveLength(5)
    expect(seed.edges.spouses.length).toBeGreaterThan(0)
    expect(Object.keys(seed.edges.parents)).toHaveLength(2)
  })

  test("rewriteEdges remaps a dropped id onto the kept id, deduping edges", async () => {
    const { rewriteEdges } = await import("./store")

    const e: TreeEdges = {
      members: ["tim", "y2", "keeps"],
      spouses: [
        ["tim", "y2"],
        ["keeps", "y2"],
      ],
      parents: { y2: [{ id: "p1" }], keeps: [{ id: "p1" }, { id: "y2" }] },
    }
    const r = rewriteEdges(e, "y1", "y2")

    expect(r.members).toEqual(["tim", "y1", "keeps"])
    expect(r.spouses).toEqual([
      ["tim", "y1"],
      ["keeps", "y1"],
    ])
    expect(Object.keys(r.parents).sort()).toEqual(["keeps", "y1"])
    expect(r.parents.y1?.map((l) => l.id)).toEqual(["p1"])
    expect(r.parents.keeps?.map((l) => l.id)).toEqual(["p1", "y1"])
  })

  test("rewriteEdges drops self-links and caps parents at two", async () => {
    const { rewriteEdges } = await import("./store")

    const e: TreeEdges = {
      members: ["a", "b"],
      spouses: [["a", "b"]],
      parents: { a: [{ id: "b" }, { id: "c" }, { id: "d" }] },
    }
    const r = rewriteEdges(e, "a", "b")

    // a married b, both collapse to a -> self-pair dropped
    expect(r.spouses).toEqual([])
    // a's parents included b (now self -> dropped), leaving c, d (capped at 2)
    expect(r.parents.a?.map((l) => l.id)).toEqual(["c", "d"])
  })

  test("propagateSurvivor mirrors a person's relatives into every tree they belong to", async () => {
    const { propagateSurvivor } = await import("./store")

    const trees: Record<string, TreeEdges> = {
      ho: { members: ["tim", "yumi"], spouses: [["tim", "yumi"]], parents: {} },
      hayashi: {
        members: ["yumi", "p1", "p2", "c1"],
        spouses: [],
        parents: { yumi: [{ id: "p1" }, { id: "p2" }], c1: [{ id: "yumi" }] },
      },
    }
    propagateSurvivor(trees, "yumi")

    const ho = trees.ho
    if (!ho) throw new Error("missing ho tree")
    expect([...ho.members].sort()).toEqual(["c1", "p1", "p2", "tim", "yumi"])
    const pairs = (s: [string, string][]) =>
      s.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)).sort()
    expect(pairs(ho.spouses)).toEqual(["tim,yumi"])
    expect(ho.parents.yumi?.map((l) => l.id).sort()).toEqual(["p1", "p2"])
    expect(ho.parents.c1?.map((l) => l.id)).toEqual(["yumi"])

    const hayashi = trees.hayashi
    if (!hayashi) throw new Error("missing hayashi tree")
    expect(hayashi.members.includes("tim")).toBe(true)
    expect(pairs(hayashi.spouses)).toEqual(["tim,yumi"])
  })
})

// ---------------------------------------------------------------------------
// applyRemote LWW merge. Each test resets the in-memory store via resetStore.
// ---------------------------------------------------------------------------

async function freshStore() {
  const store = await import("./store")
  store.resetStore()
  return store
}

describe("applyRemote LWW merge", () => {
  test("newer remote overwrites local; older is ignored", async () => {
    const store = await freshStore()
    const t1 = "2024-01-01T00:00:00.000Z"
    store.applyRemote({
      persons: [{ id: "p1", name: "Local", updatedAt: t1 }],
    })

    store.applyRemote({
      persons: [
        { id: "p1", name: "Stale", updatedAt: "2023-01-01T00:00:00.000Z" },
      ],
    })
    expect(store.getSnapshot().persons.p1?.name).toBe("Local")

    store.applyRemote({
      persons: [
        { id: "p1", name: "Fresh", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
    })
    expect(store.getSnapshot().persons.p1?.name).toBe("Fresh")
  })

  test("remote tombstone removes the local record", async () => {
    const store = await freshStore()
    store.applyRemote({
      persons: [
        { id: "p1", name: "Ghost", updatedAt: "2024-01-01T00:00:00.000Z" },
      ],
    })

    const now = new Date().toISOString()
    store.applyRemote({
      persons: [{ id: "p1", name: "", updatedAt: now, deletedAt: now }],
    })
    expect(store.getSnapshot().persons.p1).toBeUndefined()
  })

  test("applyRemote does not enqueue dirty ids", async () => {
    const store = await freshStore()
    store.applyRemote({
      persons: [{ id: "p1", name: "P", updatedAt: "2024-01-01T00:00:00.000Z" }],
    })
    // Seeding via the remote path leaves the dirty queue empty.
    expect([...store.snapshotDirty().persons.keys()]).toEqual([])

    store.applyRemote({
      persons: [
        {
          id: "p1",
          name: "Updated",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    })
    expect([...store.snapshotDirty().persons.keys()]).not.toContain("p1")
  })
})

// ---------------------------------------------------------------------------
// stampAndEnqueue — every local mutation must refresh `updatedAt` so the
// change wins the server's last-write-wins comparison. Regression coverage
// for the bug where edits to already-synced records kept a stale timestamp
// and were silently dropped by the server on push.
// ---------------------------------------------------------------------------

describe("stampAndEnqueue", () => {
  test("re-stamps updatedAt on a local edit to an already-synced person", async () => {
    const store = await freshStore()
    const { stampAndEnqueue } = store
    const t0 = "2024-01-01T00:00:00.000Z"

    const prev: GlobalState = {
      persons: { p1: { id: "p1", name: "Alice", updatedAt: t0 } },
      trees: {},
      index: [],
    }
    // Simulate an edit: new object ref, new photo, but the mutator left the
    // stale `updatedAt` from the server untouched.
    const next: GlobalState = {
      persons: {
        p1: { id: "p1", name: "Alice", photo: "data:image/jpeg;base64,…", updatedAt: t0 },
      },
      trees: {},
      index: [],
    }

    const result = stampAndEnqueue(prev, next)
    expect(result.persons.p1?.updatedAt).not.toBe(t0)
    expect(result.persons.p1?.updatedAt).toBeTruthy()
    expect([...store.snapshotDirty().persons.keys()]).toContain("p1")
  })

  test("re-stamps tree meta when its edges change", async () => {
    const store = await freshStore()
    const { stampAndEnqueue } = store
    const t0 = "2024-01-01T00:00:00.000Z"

    const prev: GlobalState = {
      persons: {},
      trees: { tr1: { members: [], spouses: [], parents: {} } },
      index: [{ id: "tr1", name: "Fam", createdAt: t0, updatedAt: t0 }],
    }
    const next: GlobalState = {
      persons: {},
      trees: { tr1: { members: ["a"], spouses: [], parents: {} } },
      index: [{ id: "tr1", name: "Fam", createdAt: t0, updatedAt: t0 }],
    }

    const result = stampAndEnqueue(prev, next)
    expect(result.index[0]?.updatedAt).not.toBe(t0)
    expect([...store.snapshotDirty().trees.keys()]).toContain("tr1")
  })
})
