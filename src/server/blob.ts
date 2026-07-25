import { del, put } from "@vercel/blob"

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

function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",")
  if (comma < 0) throw new Error("Malformed data URL")
  const base64 = dataUrl.slice(comma + 1)
  return Buffer.from(base64, "base64")
}

/**
 * Upload cropped JPEG bytes to Vercel Blob under the owner's namespace and
 * return the resulting public blob URL. The URL is never sent to the browser
 * directly — it is only read back through the auth-checked photo proxy.
 */
export async function putPhoto(
  ownerId: string,
  bytes: Buffer,
): Promise<string> {
  const pathname = `photos/${ownerId}/${crypto.randomUUID()}.jpg`
  const blob = await put(pathname, bytes, {
    access: "public",
    addRandomSuffix: false,
    contentType: "image/jpeg",
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
  return putPhoto(ownerId, decodeDataUrl(value))
}
