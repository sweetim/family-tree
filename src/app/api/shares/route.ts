import type { NextRequest } from "next/server"
import { listOwnerShares, mutateOwnerShares } from "@/server/handlers/shares"

/** `/api/shares` — aggregated shares across the caller's owned trees. */
export async function GET(request: NextRequest) {
  return listOwnerShares(request)
}

export async function PATCH(request: NextRequest) {
  return mutateOwnerShares(request)
}
