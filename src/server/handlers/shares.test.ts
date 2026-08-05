import { describe, expect, test } from "bun:test"
import { classifyShareChange, decodeOwnerShareCursor } from "./shares"

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

describe("classifyShareChange", () => {
  test("a fresh role with no prior share is a grant", () => {
    expect(classifyShareChange(undefined, "viewer")).toEqual({
      kind: "granted",
      role: "viewer",
    })
    expect(classifyShareChange(undefined, "editor")).toEqual({
      kind: "granted",
      role: "editor",
    })
  })

  test("a different prior role is a role change", () => {
    expect(classifyShareChange("viewer", "editor")).toEqual({
      kind: "roleChanged",
      role: "editor",
    })
    expect(classifyShareChange("editor", "viewer")).toEqual({
      kind: "roleChanged",
      role: "viewer",
    })
  })

  test("re-applying the same role is a no-op (no email)", () => {
    expect(classifyShareChange("viewer", "viewer")).toBeNull()
    expect(classifyShareChange("editor", "editor")).toBeNull()
  })
})
