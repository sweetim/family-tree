import { describe, expect, test } from "bun:test"
import { decodeSyncCursor, encodeSyncCursor } from "./cursor"

describe("sync cursors", () => {
  test("round-trips a tree-scoped version", () => {
    const encoded = encodeSyncCursor({ treeId: "tree-1", version: 42 })
    expect(decodeSyncCursor(encoded, "tree-1")).toEqual({
      treeId: "tree-1",
      version: 42,
    })
  })

  test("rejects malformed and cross-tree cursors", () => {
    const encoded = encodeSyncCursor({ treeId: "tree-1", version: 42 })
    expect(decodeSyncCursor(encoded, "tree-2")).toBeUndefined()
    expect(decodeSyncCursor("not-json", "tree-1")).toBeUndefined()
    expect(decodeSyncCursor(null, "tree-1")).toBeNull()
  })
})
