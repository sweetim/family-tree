import { beforeEach, describe, expect, mock, test } from "bun:test"

const get = mock()

mock.module("@vercel/blob", () => ({
  del: mock(),
  get,
  put: mock(),
}))

const {
  decodePhotoDataUrl,
  fetchStoredPhoto,
  isAllowedStoredPhotoUrl,
  isPhotoDataUrl,
  normalizePhotoUpdate,
} = await import("./blob")

beforeEach(() => {
  get.mockReset()
})

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

  test("reads private photos through the Blob SDK", async () => {
    const signal = AbortSignal.timeout(10_000)
    get.mockResolvedValue({
      statusCode: 200,
      stream: new Blob(["photo"]).stream(),
      blob: {
        contentType: "image/jpeg",
        size: 5,
      },
    })

    const response = await fetchStoredPhoto(
      "https://example.private.blob.vercel-storage.com/photos/a.jpg",
      signal,
    )

    expect(get).toHaveBeenCalledWith(
      "https://example.private.blob.vercel-storage.com/photos/a.jpg",
      { access: "private", abortSignal: signal },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("content-length")).toBe("5")
    expect(await response.text()).toBe("photo")
  })

  test("returns not found when the Blob SDK cannot find the photo", async () => {
    get.mockResolvedValue(null)

    const response = await fetchStoredPhoto(
      "https://example.private.blob.vercel-storage.com/photos/missing.jpg",
    )

    expect(response.status).toBe(404)
  })
})
