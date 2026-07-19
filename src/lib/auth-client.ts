import { createAuthClient } from "better-auth/react"

/**
 * Better Auth client (browser side). Calls go to `/api/auth/*` on the same
 * origin (handled by the Vercel Function in production, by the Bun dev
 * server locally). `useSession` is a React hook that re-fetches on mount,
 * on window focus, and on cross-tab sign-in/out.
 */
export const authClient = createAuthClient()

export const { signIn, signOut, useSession } = authClient
