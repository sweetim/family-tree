import { getAuth } from "./auth"

export type SessionUser = {
  id: string
  email: string
}

/** Resolve the authenticated user from a request, or null. */
export async function requireSession(
  request: Request,
): Promise<SessionUser | null> {
  const auth = getAuth()
  const result = await auth.api.getSession({ headers: request.headers })
  if (!result) return null
  return { id: result.user.id, email: result.user.email }
}
