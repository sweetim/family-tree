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
        familyName: "Tan",
        gender: "male",
        dob: "1948-03-02",
        dod: "2019-05-20",
        birthplace: "Penang",
        parents: [],
        spouseIds: [grandma],
        marriageDates: { [grandma]: "1971-09-14" },
      },
      [grandma]: {
        id: grandma,
        name: "Mei Ling",
        familyName: "Ling",
        gender: "female",
        dob: "1952-11-19",
        birthplace: "Penang",
        parents: [],
        spouseIds: [grandpa],
        marriageDates: { [grandpa]: "1971-09-14" },
      },
      [dad]: {
        id: dad,
        name: "David Tan",
        familyName: "Tan",
        gender: "male",
        dob: "1976-06-30",
        birthplace: "Kuala Lumpur",
        parents: [{ id: grandpa }, { id: grandma }],
        spouseIds: [mom],
        marriageDates: { [mom]: "2001-06-20" },
      },
      [mom]: {
        id: mom,
        name: "Sarah Lim",
        familyName: "Lim",
        gender: "female",
        dob: "1979-01-15",
        birthplace: "Kuala Lumpur",
        parents: [],
        spouseIds: [dad],
        marriageDates: { [dad]: "2001-06-20" },
      },
      [kid]: {
        id: kid,
        name: "Alex Tan",
        familyName: "Tan",
        dob: "2008-09-05",
        birthplace: "Singapore",
        parents: [{ id: dad }, { id: mom }],
        spouseIds: [],
        marriageDates: {},
      },
    },
  }
}
