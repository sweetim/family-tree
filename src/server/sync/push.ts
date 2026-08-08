import { getDB } from "../../db/index"
import type { SyncPushRequest } from "../../sync/types"
import { MAX_SYNC_BODY_BYTES, readJsonBody } from "../request"
import { requireSession, type SessionUser } from "../session"
import { isValidSyncId, isValidSyncPushRequest } from "../sync-validation"
import { applyRemovals, applyUpserts } from "./push-application"
import {
  discardStagedPhotos,
  finalizeCommittedPhotos,
  type PhotoLifecycle,
  preuploadMutationPhotos,
} from "./push-photos"
import {
  buildConflictResponse,
  finalizeMutation,
  prepareMutationContext,
} from "./push-pipeline"
import {
  createMutationApplicationState,
  type MutationOutcome,
} from "./push-state"

function isValidMutationId(value: string | null): value is string {
  return Boolean(value && isValidSyncId(value))
}

/** POST /api/sync — normalized CRUD with per-record ACL and conditional LWW. */
export async function postSync(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const parsed = await readJsonBody(request, MAX_SYNC_BODY_BYTES)
  if (!parsed.ok) {
    if (parsed.error === "too-large") {
      return Response.json({ error: "sync payload too large" }, { status: 413 })
    }
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  const parsedBody = parsed.value
  const validationTime = new Date()
  if (!isValidSyncPushRequest(parsedBody, validationTime)) {
    return Response.json({ error: "invalid sync payload" }, { status: 400 })
  }

  const mutationIdHeader = request.headers.get("x-sync-mutation-id")
  const mutationId = isValidMutationId(mutationIdHeader)
    ? mutationIdHeader
    : null
  if (mutationIdHeader && !mutationId) {
    return Response.json({ error: "invalid mutation id" }, { status: 400 })
  }
  return runSyncMutation(me, parsedBody, mutationId)
}

/**
 * Core normalized-CRD sync mutation, separated from the HTTP/auth adapter so
 * the full pipeline (idempotency, ACL, graph constraints, writes, change log,
 * photo lifecycle) is testable without forging an OAuth session. `me` is the
 * authenticated user and `body` is already validated by the caller.
 */
export async function runSyncMutation(
  me: SessionUser,
  body: SyncPushRequest,
  mutationId: string | null,
): Promise<Response> {
  const rootDb = getDB()
  const outcome: MutationOutcome = {}
  let committedResponse: Response | undefined
  let photoLifecycle: PhotoLifecycle | undefined

  try {
    // Stage 1: upload data URLs before acquiring the transaction connection.
    photoLifecycle = await preuploadMutationPhotos(me, body)
    const stagedPhotoLifecycle = photoLifecycle

    const transactionResponse = await rootDb.transaction(
      async (transaction) => {
        // Stage 2: serialize idempotency and graph changes, then hydrate ACL state.
        const prepared = await prepareMutationContext(
          transaction,
          me,
          body,
          mutationId,
          stagedPhotoLifecycle,
        )
        if (prepared instanceof Response) return prepared
        // Stage 3: apply removals and upserts in the established dependency order.
        const state = createMutationApplicationState()
        await applyRemovals(prepared, state)
        await applyUpserts(prepared, state)
        // Stage 4: enforce quotas, emit change-log records, and persist the receipt.
        return finalizeMutation(prepared, state, outcome, () =>
          transaction.rollback(),
        )
      },
    )
    committedResponse = transactionResponse
    await finalizeCommittedPhotos(stagedPhotoLifecycle)
    return transactionResponse
  } catch (error) {
    if (committedResponse) {
      console.error("failed to delete replaced photos", error)
      return committedResponse
    }
    if (photoLifecycle) await discardStagedPhotos(photoLifecycle)
    if (outcome.conflict) {
      return buildConflictResponse(outcome.conflict, rootDb, me.id, body)
    }
    throw error
  }
}
