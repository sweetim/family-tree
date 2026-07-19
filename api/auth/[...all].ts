import { handleAuth } from "../../src/server/auth"

/**
 * Vercel Function for Better Auth. Dispatches all `/api/auth/*` requests to
 * the Better Auth handler (sign-in, callback, session, sign-out, …).
 *
 * Vercel's Node.js runtime accepts Web-standard `Request → Response` handlers,
 * so the same `handleAuth` is mounted on the Bun dev server in `src/index.ts`.
 */
export default function handler(request: Request): Promise<Response> {
  return handleAuth(request)
}
