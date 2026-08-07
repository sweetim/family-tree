import { getFamilyPhoto } from "@/server/handlers/family-photo"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ treeId: string; jobId: string }>
}

/** `GET /api/trees/[treeId]/family-photo/[jobId]` — poll a family-photo job. */
export async function GET(request: Request, { params }: Context) {
  const { treeId, jobId } = await params
  return getFamilyPhoto(request, treeId, jobId)
}
