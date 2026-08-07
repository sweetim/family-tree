import { neon } from "@neondatabase/serverless"
import { purgeTombstones } from "../purge-tombstones"

export async function purgeTombstonesCron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization")
  if (!secret || authorization !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return Response.json({ error: "DATABASE_URL is not set" }, { status: 500 })
  }

  try {
    const result = await purgeTombstones(neon(databaseUrl), { apply: true })
    return Response.json(result)
  } catch (error) {
    console.error("Tombstone purge could not complete.")
    console.error(error instanceof Error ? error.message : String(error))
    return Response.json(
      { error: error instanceof Error ? error.message : "purge failed" },
      { status: 500 },
    )
  }
}
