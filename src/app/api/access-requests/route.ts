import { listOwnedAccessRequests } from "@/server/handlers/access-requests"

export const runtime = "nodejs"

/** Lists pending access requests across all trees owned by the signed-in user. */
export async function GET(request: Request) {
  return listOwnedAccessRequests(request)
}
