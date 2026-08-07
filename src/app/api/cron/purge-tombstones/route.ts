import { purgeTombstonesCron } from "@/server/handlers/cron-purge-tombstones"

export const runtime = "nodejs"

export const GET = purgeTombstonesCron
