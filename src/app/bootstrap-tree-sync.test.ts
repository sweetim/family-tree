import { test, expect } from "bun:test"
import { bootstrapTreeSync } from "./bootstrap-tree-sync"

/**
 * Records each step as it is called so tests can assert the exact call order.
 * `synchronize` yields a microtask before finishing so a buggy non-awaited
 * ordering would be observable.
 */
function makeRecorder() {
  const calls: string[] = []
  let syncDone = false
  const deps = {
    restore: async () => {
      calls.push("restore")
    },
    synchronize: async () => {
      calls.push("synchronize:start")
      await Promise.resolve()
      syncDone = true
      calls.push("synchronize:end")
    },
    fetchManifest: async () => {
      calls.push("fetchManifest")
      return ["manifest"] as string[]
    },
    applyManifest: () => {
      calls.push("applyManifest")
    },
    fetchSnapshot: async () => {
      calls.push(`fetchSnapshot(syncDone=${syncDone})`)
      return { ok: true }
    },
    applySnapshot: () => {
      calls.push("applySnapshot")
    },
    markHydrated: () => {
      calls.push("markHydrated")
    },
  }
  return { calls, deps }
}

test("flushes pending mutations before reading the tree snapshot", async () => {
  const { calls, deps } = makeRecorder()
  await bootstrapTreeSync({
    treeId: "tree-1",
    ...deps,
  })

  expect(calls).toEqual([
    "restore",
    "synchronize:start",
    "synchronize:end",
    "fetchManifest",
    "applyManifest",
    "fetchSnapshot(syncDone=true)",
    "applySnapshot",
    "markHydrated",
  ])
  expect(calls.indexOf("synchronize:end")).toBeLessThan(
    calls.indexOf("fetchSnapshot(syncDone=true)"),
  )
})

test("skips the snapshot when there is no selected tree", async () => {
  const { calls, deps } = makeRecorder()
  await bootstrapTreeSync({
    treeId: undefined,
    ...deps,
  })

  expect(calls).not.toContain("fetchSnapshot(syncDone=true)")
  expect(calls).not.toContain("applySnapshot")
  expect(calls.at(-1)).toBe("markHydrated")
})

test("applies nothing after cancellation", async () => {
  const { calls, deps } = makeRecorder()
  await bootstrapTreeSync({
    treeId: "tree-1",
    ...deps,
    isCancelled: () => true,
  })

  expect(calls).toEqual([
    "restore",
    "synchronize:start",
    "synchronize:end",
    "fetchManifest",
  ])
})

test("does not mark hydrated when cancelled after the snapshot resolves", async () => {
  const { calls, deps } = makeRecorder()
  let cancelled = false
  await bootstrapTreeSync({
    treeId: "tree-1",
    ...deps,
    isCancelled: () => cancelled,
    fetchSnapshot: async () => {
      calls.push("fetchSnapshot(syncDone=true)")
      cancelled = true
      return { ok: true }
    },
  })

  expect(calls).toContain("fetchSnapshot(syncDone=true)")
  expect(calls).not.toContain("applySnapshot")
  expect(calls).not.toContain("markHydrated")
})
