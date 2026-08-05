import { describe, expect, test } from "bun:test"
import {
  getPersistenceUserId,
  persistCurrentStore,
  resetPersistenceCoordinator,
  schedulePersistence,
  setPersistenceUserId,
} from "./persistence-coordinator"

describe("persistence coordinator lifecycle ownership", () => {
  test("tracks and clears the active persistence user", () => {
    resetPersistenceCoordinator()
    expect(getPersistenceUserId()).toBeNull()

    setPersistenceUserId("user")
    expect(getPersistenceUserId()).toBe("user")

    resetPersistenceCoordinator()
    expect(getPersistenceUserId()).toBeNull()
  })

  test("does not schedule or write without an active user", async () => {
    resetPersistenceCoordinator()

    schedulePersistence()
    await expect(persistCurrentStore()).resolves.toBeUndefined()
  })
})
