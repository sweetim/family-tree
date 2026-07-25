import { eq } from "drizzle-orm"
import { getDB } from "../../db/index"
import { persons } from "../../db/schema"
import { canRead, personRole } from "../acl"
import { getAuth } from "../auth"

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
  if (!canRead(await personRole(db, session.user.id, personId))) {
    return new Response(null, { status: 404 })
  }

  const upstream = await fetch(person.photo)
  if (!upstream.ok || !upstream.body) {
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
