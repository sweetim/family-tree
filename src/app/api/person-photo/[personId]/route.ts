import { getPersonPhoto } from "@/server/handlers/person-photo"

type Context = {
  params: Promise<{ personId: string }>
}

/** `/api/person-photo/[personId]` — authorized, server-streamed person avatar. */
export async function GET(request: Request, { params }: Context) {
  const { personId } = await params
  return getPersonPhoto(request, personId)
}
