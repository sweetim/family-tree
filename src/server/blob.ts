import { del, get, put } from "@vercel/blob"
import { MAX_PHOTO_BYTES } from "./limits"

const DATA_URL_PREFIX = "data:"

/** Lazily read the server-only Blob token. Throws if not configured. */
function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN
  if (!value) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Create a Vercel Blob store and add its token to .env.local / Vercel env vars.",
    )
  }
  return value
}

/** True when `value` is an inline base64 data URL (i.e. not yet in Blob). */
export function isPhotoDataUrl(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.startsWith(DATA_URL_PREFIX)
}

export function isAllowedStoredPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:"
      && (url.hostname.endsWith(".public.blob.vercel-storage.com")
        || url.hostname.endsWith(".private.blob.vercel-storage.com"))
    )
  } catch {
    return false
  }
}

export function decodePhotoDataUrl(dataUrl: string): {
  bytes: Buffer
  contentType: "image/jpeg" | "image/png" | "image/webp"
} {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error("Photo must be a base64 image data URL")
  const contentType = match[1] as "image/jpeg" | "image/png" | "image/webp"
  const base64 = match[2] ?? ""
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Malformed photo data URL")
  }
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw new Error("Photo exceeds the maximum size")
  }
  return { bytes, contentType }
}

/**
 * Upload cropped JPEG bytes to Vercel Blob under the owner's namespace and
 * return the resulting blob URL. The store is private, so the URL must be read
 * server-side with the service token (see {@link fetchStoredPhoto}) by the
 * auth-checked photo proxy — it is never sent to the browser directly.
 */
async function putPhoto(
  ownerId: string,
  bytes: Buffer,
  contentType = "image/jpeg",
): Promise<string> {
  const pathname = `photos/${ownerId}/${crypto.randomUUID()}.jpg`
  const blob = await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType,
    token: token(),
  })
  return blob.url
}

/**
 * Delete a previously stored blob URL. Failures are swallowed: an orphaned
 * blob is harmless and must not break a person update.
 */
export async function deletePhoto(url: string): Promise<void> {
  try {
    await del([url], { token: token() })
  } catch (err) {
    console.error("failed to delete blob", err)
  }
}

/**
 * Fetch a stored blob photo. The SDK uses Vercel OIDC in deployed functions and
 * falls back to the configured read-write token outside Vercel.
 */
export async function fetchStoredPhoto(
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  const result = await get(url, {
    access: "private",
    abortSignal: signal,
  })
  if (result?.statusCode !== 200) {
    return new Response(null, { status: result?.statusCode ?? 404 })
  }
  return new Response(result.stream, {
    headers: {
      "content-length": String(result.blob.size),
      "content-type": result.blob.contentType,
    },
  })
}

/**
 * Ensure a photo value is a Blob URL. If it is already a URL (or empty), it is
 * returned unchanged. If it is a base64 data URL, the bytes are uploaded and
 * the new Blob URL is returned.
 */
export async function normalizePhoto(
  ownerId: string,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null
  if (!isPhotoDataUrl(value)) return value
  const photo = decodePhotoDataUrl(value)
  return putPhoto(ownerId, photo.bytes, photo.contentType)
}

export function normalizePhotoUpdate(
  ownerId: string,
  existingPhoto: string | null,
  value: string | null | undefined,
): Promise<string | null> {
  return value === undefined
    ? Promise.resolve(existingPhoto)
    : normalizePhoto(ownerId, value)
}
