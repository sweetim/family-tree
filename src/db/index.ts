import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import * as schema from "./schema"

/**
 * Lazily-created transaction-capable DB client. Mutations need an interactive
 * transaction because authorization, graph validation, and writes must commit
 * together. The small pool keeps each serverless instance bounded while a Blob
 * upload is staged for a photo mutation.
 */
function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon (Vercel Marketplace) and add it to .env.local / Vercel env vars.",
    )
  }
  const pool = new Pool({ connectionString: url, max: 5 })
  return drizzle({ client: pool, schema })
}

let cached: ReturnType<typeof createClient> | null = null

export function getDB() {
  if (!cached) cached = createClient()
  return cached
}

type RootDB = ReturnType<typeof createClient>
type TransactionDB = Parameters<Parameters<RootDB["transaction"]>[0]>[0]
export type DB = RootDB | TransactionDB
export { schema }
