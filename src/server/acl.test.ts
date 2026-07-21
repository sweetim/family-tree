import { describe, expect, test } from "bun:test"
import { canRead, canWrite, type Role, resolvePersonRole } from "./acl"

const PERSON = { ownerId: "owner-1", deletedAt: null }

describe("ACL — resolvePersonRole", () => {
  test("returns null when the person row does not exist", () => {
    expect(resolvePersonRole("u", null, [])).toBeNull()
  })

  test("returns null when the person is tombstoned", () => {
    expect(
      resolvePersonRole("u", { ownerId: "owner-1", deletedAt: new Date() }, []),
    ).toBeNull()
  })

  test("returns owner when the user owns the person row", () => {
    expect(resolvePersonRole("owner-1", PERSON, [])).toBe<Role>("owner")
  })

  test("returns null when the user has no relationship to the person", () => {
    expect(resolvePersonRole("stranger", PERSON, [])).toBeNull()
  })

  test("returns viewer when the user is a viewer on a tree containing the person", () => {
    expect(
      resolvePersonRole("u", PERSON, [
        { ownerId: "owner-1", shareRole: "viewer" },
      ]),
    ).toBe("viewer")
  })

  test("returns editor when the user is an editor on a containing tree", () => {
    expect(
      resolvePersonRole("u", PERSON, [
        { ownerId: "owner-1", shareRole: "editor" },
      ]),
    ).toBe("editor")
  })

  test("returns owner when the user owns a tree containing someone else's person", () => {
    // E.g. an editor added a person to my tree; I now own the tree so I outrank.
    expect(
      resolvePersonRole("u", PERSON, [{ ownerId: "u", shareRole: null }]),
    ).toBe("owner")
  })

  test("picks the highest role across multiple accessible trees", () => {
    expect(
      resolvePersonRole("u", PERSON, [
        { ownerId: "owner-1", shareRole: "viewer" },
        { ownerId: "owner-1", shareRole: "editor" },
      ]),
    ).toBe("editor")
    expect(
      resolvePersonRole("u", PERSON, [
        { ownerId: "u", shareRole: null },
        { ownerId: "owner-1", shareRole: "viewer" },
      ]),
    ).toBe("owner")
  })
})

describe("ACL — canRead / canWrite guards", () => {
  test("canWrite is true for owner and editor only", () => {
    expect(canWrite("owner")).toBe(true)
    expect(canWrite("editor")).toBe(true)
    expect(canWrite("viewer")).toBe(false)
    expect(canWrite(null)).toBe(false)
  })

  test("canRead is true for any non-null role", () => {
    expect(canRead("owner")).toBe(true)
    expect(canRead("editor")).toBe(true)
    expect(canRead("viewer")).toBe(true)
    expect(canRead(null)).toBe(false)
  })
})
