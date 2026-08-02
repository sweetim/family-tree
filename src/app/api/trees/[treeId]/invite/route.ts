import type { NextRequest } from "next/server"
import { getTreeInviteInfo } from "@/server/handlers/trees"

type Context = {
  params: Promise<{ treeId: string }>
}

export async function GET(_request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return getTreeInviteInfo(treeId)
}
