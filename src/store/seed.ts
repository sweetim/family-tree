import type { FamilyData } from "../types"
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
        name: "Henry Carter",
        familyName: "Carter",
        gender: "male",
        dob: "1948-03-02",
        dod: "2019-05-20",
        birthplace: "Boston",
        parents: [],
        spouseIds: [grandma],
        marriageDates: { [grandma]: "1971-09-14" },
      },
      [grandma]: {
        id: grandma,
        name: "Margaret Hayes",
        familyName: "Hayes",
        gender: "female",
        dob: "1952-11-19",
        birthplace: "Boston",
        parents: [],
        spouseIds: [grandpa],
        marriageDates: { [grandpa]: "1971-09-14" },
      },
      [dad]: {
        id: dad,
        name: "David Carter",
        familyName: "Carter",
        gender: "male",
        dob: "1976-06-30",
        birthplace: "Chicago",
        parents: [{ id: grandpa }, { id: grandma }],
        spouseIds: [mom],
        marriageDates: { [mom]: "2001-06-20" },
      },
      [mom]: {
        id: mom,
        name: "Sarah Bennett",
        familyName: "Bennett",
        gender: "female",
        dob: "1979-01-15",
        birthplace: "Chicago",
        parents: [],
        spouseIds: [dad],
        marriageDates: { [dad]: "2001-06-20" },
      },
      [kid]: {
        id: kid,
        name: "Alex Carter",
        familyName: "Carter",
        dob: "2008-09-05",
        birthplace: "New York",
        parents: [{ id: dad }, { id: mom }],
        spouseIds: [],
        marriageDates: {},
      },
    },
  }
}
