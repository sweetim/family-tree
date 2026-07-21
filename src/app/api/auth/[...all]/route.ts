import { handleAuth } from "@/server/auth"

/**
 * Better Auth — all `/api/auth/*` requests (sign-in, callback, session,
 * sign-out). The same `handleAuth` powered the Bun dev server before the
 * Next.js migration.
 */
export const GET = handleAuth
export const POST = handleAuth
