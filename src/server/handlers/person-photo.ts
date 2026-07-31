import { eq } from "drizzle-orm"
import { getDB } from "../../db/index"
import { persons } from "../../db/schema"
import { canRead, personRole } from "../acl"
import { getAuth } from "../auth"
import {
  fetchStoredPhoto,
  isAllowedStoredPhotoUrl,
  MAX_PHOTO_BYTES,
} from "../blob"

const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PHOTO_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Streams a person's photo to an authorized viewer. Authorization mirrors the
 * rest of the app: the session user must have at least a viewer role on the
 * person (owner of the person row or of any tree containing it). The blob URL
 * itself is never exposed to the browser — reads only happen through this
 * route. Returns 404 (not 403) for missing/forbidden so existence is not leaked.
 */
export async function getPersonPhoto(
  request: Request,
  personId: string,
): Promise<Response> {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return new Response(null, { status: 401 })

  const db = getDB()
  const person = await db.query.persons.findFirst({
    where: eq(persons.id, personId),
  })
  if (!person || person.deletedAt || !person.photo) {
    return new Response(null, { status: 404 })
  }
  if (
    person.ownerId !== session.user.id
    && !canRead(await personRole(db, session.user.id, personId))
  ) {
    return new Response(null, { status: 404 })
  }
  if (!isAllowedStoredPhotoUrl(person.photo)) {
    return new Response(null, { status: 502 })
  }

  let upstream: Response
  try {
    upstream = await fetchStoredPhoto(person.photo, AbortSignal.timeout(10_000))
  } catch {
    return new Response(null, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: 502 })
  }
  const contentType =
    upstream.headers.get("content-type")?.split(";", 1)[0]?.trim()
    ?? "image/jpeg"
  if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
    await upstream.body.cancel()
    return new Response(null, { status: 502 })
  }
  const contentLength = Number(upstream.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES) {
    await upstream.body.cancel()
    return new Response(null, { status: 502 })
  }
  const bytes = await readBoundedBody(upstream.body)
  if (!bytes) return new Response(null, { status: 502 })
  return new Response(bytes, {
    status: upstream.status,
    headers: {
      "content-type": contentType,
      // Cacheable by URL: the proxy URL includes ?v={updatedAt}, so a changed
      // photo is a different URL and always re-fetched. `private` keeps it
      // browser-only (no shared CDN). Lets React Flow's off-screen node culling
      // reuse the browser cache instead of re-downloading on remount.
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  })
}
