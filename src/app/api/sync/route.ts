import { getSync } from "@/server/handlers/sync"

/** Legacy pull compatibility. Mutations require revisions and idempotency. */
export const GET = (request: Request) => getSync(request)
export const POST = () =>
  Response.json(
    { error: "legacy sync writes retired; use /api/v2/mutations" },
    { status: 426 },
  )
