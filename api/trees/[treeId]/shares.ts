import {
  addShare,
  listShares,
  removeShare,
} from "../../../src/server/handlers/shares"

/**
 * Vercel Function for `/api/trees/:treeId/shares`. Owner-only CRUD on a
 * tree's share list. Same handlers power the Bun dev server.
 */
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // Vercel's file-system router gives us `/api/trees/<treeId>/shares`; we
  // recover the treeId from the path.
  const match = url.pathname.match(/^\/api\/trees\/([^/]+)\/shares$/)
  const treeId = match?.[1]
  if (!treeId) return new Response("Not found", { status: 404 })

  if (request.method === "GET") return listShares(request, treeId)
  if (request.method === "POST") return addShare(request, treeId)
  if (request.method === "DELETE") return removeShare(request, treeId)
  return new Response("Method not allowed", { status: 405 })
}
