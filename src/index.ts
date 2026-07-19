import { serve } from "bun";
import index from "./index.html";
import { addShare, listShares, removeShare } from "./server/handlers/shares";
import { getSync, postSync } from "./server/handlers/sync";
import { handleAuth } from "./server/auth";

async function sharesHandler(req: Request, treeId: string): Promise<Response> {
  if (req.method === "GET") return listShares(req, treeId);
  if (req.method === "POST") return addShare(req, treeId);
  if (req.method === "DELETE") return removeShare(req, treeId);
  return new Response("Method not allowed", { status: 405 });
}

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    // Better Auth — same handler is exported by api/auth/[...all].ts on Vercel.
    "/api/auth/*": req => handleAuth(req),

    // Sync — pull (GET) + push (POST). Same handlers power api/sync.ts on Vercel.
    "/api/sync": req => {
      if (req.method === "GET") return getSync(req);
      if (req.method === "POST") return postSync(req);
      return new Response("Method not allowed", { status: 405 });
    },

    // Per-tree shares — owner-only CRUD. Same handlers power api/trees/[treeId]/shares.ts.
    "/api/trees/:treeId/shares": req => sharesHandler(req, req.params.treeId),

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
