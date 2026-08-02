export const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "invalid-json" | "too-large" }

export type BoundedBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "too-large" | "empty" }

/**
 * Read a stream fully into a single buffer, rejecting anything that would
 * exceed `maximumBytes`. Shared by the JSON body reader and the photo proxy
 * so an unbounded request can never allocate without bound. Returns `empty`
 * when there is no body.
 */
export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<BoundedBytesResult> {
  if (!body) return { ok: false, error: "empty" }
  const reader = body.getReader()
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

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

/** Read and parse JSON without allowing an unbounded request allocation. */
export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return { ok: false, error: "too-large" }
  }

  const result = await readBoundedBytes(request.body, maximumBytes)
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "empty" ? "invalid-json" : "too-large",
    }
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(result.bytes)),
    }
  } catch {
    return { ok: false, error: "invalid-json" }
  }
}
