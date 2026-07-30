import type { SyncMutationRequest } from "../../sync/types"
import { MAX_SYNC_BODY_BYTES, readJsonBody } from "../request"
import { requireSession } from "../session"
import { postSync } from "../sync/push"
import { isValidSyncId, isValidSyncPushRequest } from "../sync-validation"

function isMutationRequest(value: unknown): value is SyncMutationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    Object.keys(candidate).length === 4
    && candidate.protocolVersion === 2
    && isValidSyncId(candidate.deviceId)
    && isValidSyncId(candidate.mutationId)
    && isValidSyncPushRequest(candidate.records, new Date())
  )
}

/** Idempotent, atomic normalized mutation endpoint. */
export async function postMutation(request: Request): Promise<Response> {
  if (!(await requireSession(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const parsed = await readJsonBody(request, MAX_SYNC_BODY_BYTES)
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.error === "too-large"
            ? "mutation payload too large"
            : "invalid JSON",
      },
      { status: parsed.error === "too-large" ? 413 : 400 },
    )
  }
  if (!isMutationRequest(parsed.value)) {
    return Response.json({ error: "invalid mutation payload" }, { status: 400 })
  }

  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.set("x-sync-mutation-id", parsed.value.mutationId)
  return postSync(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.value.records),
    }),
  )
}
