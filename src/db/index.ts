import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"

/**
 * Lazily-created DB client. The neon HTTP driver opens one fetch-backed SQL
 * connection per query, so a module-level singleton is fine on Vercel
 * functions and on the Bun dev server. Importing this file does not connect;
 * nothing happens until the first query runs.
 */
function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon (Vercel Marketplace) and add it to .env.local / Vercel env vars.",
    )
  }
  const sql = neon(url)
  return drizzle({ client: sql, schema })
}

let cached: ReturnType<typeof createClient> | null = null

export function getDB() {
  if (!cached) cached = createClient()
  return cached
}

export type DB = ReturnType<typeof createClient>
export { schema }
