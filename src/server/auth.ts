import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { and, eq, isNull } from "drizzle-orm"
import { getDB } from "../db/index.js"
import { account, session, treeShares, user, verification } from "../db/schema.js"

/**
 * Better Auth instance: Google social provider + Drizzle adapter on Neon.
 * After a new user is created, any pending `tree_shares` rows keyed by their
 * email (created by an owner before this person ever signed in) get bound to
 * the new user id, so shared trees appear on their first login.
 *
 * Built lazily: the dev server / Vercel function can boot without a DATABASE_URL
 * (anonymous mode is fully functional); only the first /api/auth request that
 * needs the DB will throw a clear error.
 */
let cached: ReturnType<typeof buildAuth> | null = null

function buildAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDB(), {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            const email = created.email?.toLowerCase()
            if (!email) return
            const database = getDB()
            await database
              .update(treeShares)
              .set({ userId: created.id })
              .where(
                and(eq(treeShares.email, email), isNull(treeShares.userId)),
              )
          },
        },
      },
    },
  })
}

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!cached) cached = buildAuth()
  return cached
}

/** Fetch handler — used by both the Bun dev server and the Vercel function. */
export function handleAuth(request: Request): Promise<Response> {
  return getAuth().handler(request)
}
