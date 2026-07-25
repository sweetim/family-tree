import { type FamilyData } from "../types"
import { newId } from "./state"

export type TreeSeed = { people: FamilyData }

export function seedData(): TreeSeed {
  const grandpa = newId()
  const grandma = newId()
  const dad = newId()
  const mom = newId()
  const kid = newId()
  return {
    people: {
      [grandpa]: {
        id: grandpa,
        name: "Henry Tan",
        gender: "male",
        dob: "1948-03-02",
        dod: "2019-05-20",
        location: "Penang",
        parents: [],
        spouseIds: [grandma],
        marriageDates: { [grandma]: "1971-09-14" },
      },
      [grandma]: {
        id: grandma,
        name: "Mei Ling",
        gender: "female",
        dob: "1952-11-19",
        location: "Penang",
        parents: [],
        spouseIds: [grandpa],
        marriageDates: { [grandpa]: "1971-09-14" },
      },
      [dad]: {
        id: dad,
        name: "David Tan",
        gender: "male",
        dob: "1976-06-30",
        location: "Kuala Lumpur",
        parents: [{ id: grandpa }, { id: grandma }],
        spouseIds: [mom],
        marriageDates: { [mom]: "2001-06-20" },
      },
      [mom]: {
        id: mom,
        name: "Sarah Lim",
        gender: "female",
        dob: "1979-01-15",
        location: "Kuala Lumpur",
        parents: [],
        spouseIds: [dad],
        marriageDates: { [dad]: "2001-06-20" },
      },
      [kid]: {
        id: kid,
        name: "Alex Tan",
        dob: "2008-09-05",
        location: "Singapore",
        parents: [{ id: dad }, { id: mom }],
        spouseIds: [],
        marriageDates: {},
      },
    },
  }
}
