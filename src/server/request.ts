export const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "invalid-json" | "too-large" }

/** Read and parse JSON without allowing an unbounded request allocation. */
export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return { ok: false, error: "too-large" }
  }

  if (!request.body) return { ok: false, error: "invalid-json" }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maximumBytes) {
      await reader.cancel()
      return { ok: false, error: "too-large" }
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) }
  } catch {
    return { ok: false, error: "invalid-json" }
  }
}
