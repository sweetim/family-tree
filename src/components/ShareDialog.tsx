import { Check, Loader2, Trash2, UserPlus, XCircle } from "lucide-react"
import { type FormEvent, useState } from "react"
import { useOwnerAccessRequests } from "@/lib/access-requests"
import { useShares } from "@/lib/shares"
import { Modal } from "./Modal"
import { RoleSelect } from "./RoleSelect"

/**
 * Modal for a tree owner to manage shares and access requests.
 */
export function ShareDialog({
  treeId,
  treeName,
  onClose,
}: {
  treeId: string
  treeName: string
  onClose: () => void
}) {
  const {
    shares,
    loading,
    adding,
    submittingEmail,
    submittingMutation,
    add,
    updateRole,
    remove,
  } = useShares(treeId)
  const {
    requests,
    loading: requestsLoading,
    submitting: requestsSubmitting,
    resolve,
  } = useOwnerAccessRequests(treeId)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"viewer" | "editor">("viewer")

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    const ok = await add(trimmed, role)
    if (ok) setEmail("")
  }

  return (
    <Modal
      onClose={onClose}
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lift">
        <div className="mb-1">
          <h2 className="text-lg font-bold tracking-tight text-slate-800">
            Share tree
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{treeName}</span> —
            anyone you add can open it from any device after signing in with the
            email below.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
        >
          <label
            htmlFor="share-email-input"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Invite by email
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <input
              id="share-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="relative@example.com"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
              required
            />
            <RoleSelect
              value={role}
              disabled={adding}
              loading={false}
              label="Invite role"
              allowNone={false}
              onChange={(next) => {
                if (next) setRole(next)
              }}
            />
            <button
              type="submit"
              disabled={adding || !email.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Editors can change this tree's people (and those changes flow back
            to the owner). Server enforces permissions regardless of UI state.
          </p>
        </form>

        {loading || requestsLoading ? (
          <div className="mt-5 space-y-5" aria-busy="true">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                People with access
              </h3>
              <div className="space-y-1.5">
                <ShareSkeleton />
                <ShareSkeleton />
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Access requests
              </h3>
              <div className="space-y-2">
                <AccessRequestSkeleton />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                People with access
              </h3>
              {shares.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                  Not shared with anyone yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {shares.map((share) => {
                    return (
                      <li
                        key={share.email}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <RoleSelect
                          value={share.role}
                          disabled={submittingEmail !== null}
                          loading={
                            submittingMutation === "update"
                            && submittingEmail === share.email
                          }
                          label={`Access for ${share.email}`}
                          allowNone={false}
                          onChange={(next) => {
                            if (next) void updateRole(share.email, next)
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-700">
                            {share.email}
                          </p>
                          <p
                            className={`text-[11px] uppercase tracking-wide ${
                              share.role === "editor"
                                ? "text-emerald-600"
                                : "text-cobalt-600"
                            }`}
                          >
                            {share.role}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(share.email)}
                          disabled={submittingEmail !== null}
                          title="Revoke access"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          {submittingMutation === "remove"
                          && submittingEmail === share.email ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {requests.length > 0 ? (
              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Access requests
                </h3>
                <ul className="space-y-2">
                  {requests.map((request) => (
                    <li
                      key={request.userId}
                      className="rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-700">
                          {request.name || request.email}
                        </p>
                        {request.name && request.name !== request.email ? (
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {request.email}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        “{request.comment}”
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => resolve(request.userId, "approve")}
                          disabled={requestsSubmitting}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => resolve(request.userId, "deny")}
                          disabled={requestsSubmitting}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-all hover:bg-red-50 active:scale-95 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}

function ShareSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <div className="h-9 w-24 shrink-0 tree-skeleton animate-shimmer rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/3 tree-skeleton animate-shimmer rounded" />
        <div className="h-2.5 w-10 tree-skeleton animate-shimmer rounded" />
      </div>
      <div className="h-9 w-9 shrink-0 tree-skeleton animate-shimmer rounded-lg" />
    </div>
  )
}

function AccessRequestSkeleton() {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2">
      <div className="h-3 w-1/2 tree-skeleton animate-shimmer rounded" />
      <div className="h-3 w-full tree-skeleton animate-shimmer rounded" />
      <div className="h-3 w-3/4 tree-skeleton animate-shimmer rounded" />
      <div className="flex gap-2">
        <div className="h-7 flex-1 tree-skeleton animate-shimmer rounded-lg" />
        <div className="h-7 flex-1 tree-skeleton animate-shimmer rounded-lg" />
      </div>
    </div>
  )
}
