import { eq } from "drizzle-orm"
import { getDB } from "../../db/index"
import { persons } from "../../db/schema"
import { canRead, personRole } from "../acl"
import { getAuth } from "../auth"
import {
  decodePhotoDataUrl,
  fetchStoredPhoto,
  isAllowedStoredPhotoUrl,
  isPhotoDataUrl,
  MAX_PHOTO_BYTES,
} from "../blob"

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
  if (isPhotoDataUrl(person.photo)) {
    try {
      const photo = decodePhotoDataUrl(person.photo)
      return new Response(photo.bytes, {
        headers: {
          "content-type": photo.contentType,
          "cache-control": "private, max-age=3600, immutable",
        },
      })
    } catch {
      return new Response(null, { status: 502 })
    }
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
  const contentLength = Number(upstream.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES) {
    await upstream.body.cancel()
    return new Response(null, { status: 502 })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      // Private so shared devices and CDNs never cache another user's avatar.
      "cache-control": "private, max-age=3600, immutable",
    },
  })
}
