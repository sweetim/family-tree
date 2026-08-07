import { getTreeActivity } from "@/server/handlers/activity"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ treeId: string }> },
) {
  const { treeId } = await context.params
  return getTreeActivity(request, treeId)
}
