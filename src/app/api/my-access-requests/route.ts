import { listMyAccessRequests } from "@/server/handlers/access-requests"

export const runtime = "nodejs"

/** Lists the signed-in user's own access requests across all trees. */
export async function GET(request: Request) {
  return listMyAccessRequests(request)
}
