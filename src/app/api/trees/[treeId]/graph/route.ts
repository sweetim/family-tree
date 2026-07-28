import { getTreeGraph } from "@/server/handlers/trees"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ treeId: string }> },
) {
  const { treeId } = await context.params
  return getTreeGraph(request, treeId)
}
