import { describe, expect, test } from "bun:test"
import { decodeOwnerShareCursor } from "./shares"

describe("owner share cursors", () => {
  test("round-trips an email cursor", () => {
    const cursor = Buffer.from("relative@example.com").toString("base64url")

    expect(decodeOwnerShareCursor(cursor)).toBe("relative@example.com")
  })

  test("rejects empty and malformed cursors", () => {
    expect(decodeOwnerShareCursor("")).toBeNull()
    expect(
      decodeOwnerShareCursor(Buffer.from("bad\0value").toString("base64url")),
    ).toBeUndefined()
    expect(decodeOwnerShareCursor(null)).toBeNull()
  })
})
