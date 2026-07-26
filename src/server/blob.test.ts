import { describe, expect, test } from "bun:test"
import {
  decodePhotoDataUrl,
  isAllowedStoredPhotoUrl,
  isPhotoDataUrl,
  normalizePhotoUpdate,
} from "./blob"

describe("photo input boundaries", () => {
  test("recognizes inline photos", () => {
    expect(isPhotoDataUrl("data:image/jpeg;base64,YQ==")).toBe(true)
    expect(isPhotoDataUrl("https://example.test/photo.jpg")).toBe(false)
  })

  test("proxies public and private Vercel Blob URLs", () => {
    expect(
      isAllowedStoredPhotoUrl(
        "https://example.public.blob.vercel-storage.com/photos/a.jpg",
      ),
    ).toBe(true)
    expect(
      isAllowedStoredPhotoUrl(
        "https://example.private.blob.vercel-storage.com/photos/a.jpg",
      ),
    ).toBe(true)
    expect(isAllowedStoredPhotoUrl("https://example.test/photo.jpg")).toBe(
      false,
    )
    expect(
      isAllowedStoredPhotoUrl(
        "http://example.public.blob.vercel-storage.com/photo.jpg",
      ),
    ).toBe(false)
  })

  test("retains an existing photo when an update omits photo", async () => {
    expect(
      await normalizePhotoUpdate(
        "owner",
        "https://example.public.blob.vercel-storage.com/photo.jpg",
        undefined,
      ),
    ).toBe("https://example.public.blob.vercel-storage.com/photo.jpg")
  })

  test("decodes supported legacy image data URLs", () => {
    expect(decodePhotoDataUrl("data:image/png;base64,YQ==")).toMatchObject({
      contentType: "image/png",
      bytes: Buffer.from("a"),
    })
  })
})
