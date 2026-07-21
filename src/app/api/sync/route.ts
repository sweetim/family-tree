import { getSync, postSync } from "@/server/handlers/sync"

/** `/api/sync` — GET pulls deltas, POST pushes batched upserts. */
export const GET = (request: Request) => getSync(request)
export const POST = (request: Request) => postSync(request)
