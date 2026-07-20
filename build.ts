import { unlink } from "node:fs/promises"
import tailwind from "bun-plugin-tailwind"

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Bundle each Vercel api/ function into a self-contained .js. @vercel/node
// transpiles these entry points in place without bundling, so cross-directory
// imports (../../src/server/...) are absent from the Lambda at runtime
// (ERR_MODULE_NOT_FOUND). Inlining all of src/ + node_modules per function
// removes the runtime dependency on the src/ tree. The .ts source is dropped
// on Vercel so only the bundled .js is detected as the function.
const apiEntries = [
  "api/auth/[...all].ts",
  "api/sync.ts",
  "api/trees/[treeId]/shares.ts",
]

for (const entry of apiEntries) {
  const outdir = entry.split("/").slice(0, -1).join("/")
  const res = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "node",
    format: "esm",
    sourcemap: "external",
  })
  if (!res.success) {
    for (const log of res.logs) console.error(log)
    process.exit(1)
  }
  if (process.env.VERCEL) await unlink(entry)
}

console.log(`Built ${result.outputs.length} files to ./dist`)
