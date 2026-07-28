import type { NextRequest } from "next/server"
import {
  createAccessRequest,
  getAccessRequest,
} from "@/server/handlers/access-requests"

type Context = {
  params: Promise<{ treeId: string }>
}

/** `/api/trees/:treeId/access-request` — a requester's own access request. */
export async function GET(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return getAccessRequest(request, treeId)
}

export async function POST(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return createAccessRequest(request, treeId)
}
