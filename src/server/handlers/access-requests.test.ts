import { describe, expect, test } from "bun:test"
import { encodeCursorJson } from "../sync/cursor"
import { decodeOwnedAccessRequestCursor } from "./access-requests"

describe("owned access request cursors", () => {
  test("round-trips a valid aggregate-list cursor", () => {
    const cursor = {
      createdAt: "2026-08-02T00:00:00.000Z",
      treeId: "tree-1",
      userId: "user-1",
    }

    expect(decodeOwnedAccessRequestCursor(encodeCursorJson(cursor))).toEqual(
      cursor,
    )
  })

  test("rejects incomplete and malformed cursors", () => {
    expect(
      decodeOwnedAccessRequestCursor(
        encodeCursorJson({
          createdAt: "2026-08-02T00:00:00.000Z",
          treeId: "tree-1",
        }),
      ),
    ).toBeUndefined()
    expect(decodeOwnedAccessRequestCursor("not-json")).toBeUndefined()
    expect(decodeOwnedAccessRequestCursor(null)).toBeNull()
  })
})
