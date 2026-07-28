import type { NextRequest } from "next/server"
import {
  listAccessRequests,
  resolveAccessRequest,
} from "@/server/handlers/access-requests"

type Context = {
  params: Promise<{ treeId: string }>
}

/** `/api/trees/:treeId/access-requests` — owner-only list + resolve. */
export async function GET(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return listAccessRequests(request, treeId)
}

export async function POST(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return resolveAccessRequest(request, treeId)
}
