import type { NextRequest } from "next/server"
import { deleteTree } from "@/server/handlers/trees"

type Context = {
  params: Promise<{ treeId: string }>
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { treeId } = await params
  return deleteTree(request, treeId)
}
