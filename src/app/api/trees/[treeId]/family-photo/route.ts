import { startFamilyPhoto } from "@/server/handlers/family-photo"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ treeId: string }>
}

/** `POST /api/trees/[treeId]/family-photo` — start a background family-photo job. */
export async function POST(request: Request, { params }: Context) {
  const { treeId } = await params
  return startFamilyPhoto(request, treeId)
}
