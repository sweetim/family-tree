import type { NextRequest } from "next/server"
import { addShare, listShares, removeShare } from "@/server/handlers/shares"

type Context = {
  params: Promise<{ treeId: string }>
}

/** `/api/trees/:treeId/shares` — owner-only CRUD on a tree's share list. */
export async function GET(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return listShares(request, treeId)
}

export async function POST(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return addShare(request, treeId)
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return removeShare(request, treeId)
}
