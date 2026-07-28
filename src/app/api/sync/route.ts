import { getSync } from "@/server/handlers/sync"

export const GET = (request: Request) => getSync(request)
