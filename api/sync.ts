import { getSync, postSync } from "../src/server/handlers/sync"

/**
 * Vercel Function for `/api/sync`. Dispatches GET (pull) and POST (push) to
 * the shared handlers. The same handlers are mounted on the Bun dev server
 * in `src/index.ts`.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") return getSync(request)
    if (request.method === "POST") return postSync(request)
    return new Response("Method not allowed", { status: 405 })
  },
}
