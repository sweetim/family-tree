import { expect, test } from "bun:test"
import { useStore } from "./state-hooks"
import { getSnapshot, resetStore, update } from "./state"

const timestamp = "2024-01-01T00:00:00.000Z"

test("Zustand owns the committed graph across updates and resets", () => {
  resetStore()
  const initialGraph = useStore.getState().state

  update(
    (previous) => ({
      ...previous,
      persons: {
        person: {
          id: "person",
          name: "Person",
          familyName: "",
          updatedAt: timestamp,
        },
      },
    }),
    { remote: true },
  )

  const updatedGraph = useStore.getState().state
  expect(updatedGraph).toBe(getSnapshot())
  expect(updatedGraph).not.toBe(initialGraph)
  expect(updatedGraph.persons.person?.name).toBe("Person")

  resetStore()

  expect(useStore.getState().state).toBe(getSnapshot())
  expect(useStore.getState().state).not.toBe(updatedGraph)
  expect(useStore.getState().state.persons).toEqual({})
})
