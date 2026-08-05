import { expect, test } from "bun:test"
import { personPhotoSrc, photoProxyUrl } from "./image"

test("uses only the photo timestamp to version stored avatar URLs", () => {
  expect(
    personPhotoSrc({
      id: "person",
      photo: "stored-photo",
      photoUpdatedAt: "2026-08-05T00:00:00.000Z",
    }),
  ).toBe("/api/person-photo/person?v=2026-08-05T00%3A00%3A00.000Z")
  expect(photoProxyUrl("person")).toBe("/api/person-photo/person")
})
