import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { useAccessRequest } from "@/lib/access-requests"

export type AccessRequestFormState = {
  active: boolean
  canSubmit: boolean
  submitting: boolean
}

export function AccessRequestSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
    >
      <div className="mx-auto h-12 w-12 tree-skeleton animate-shimmer rounded-2xl" />
      <div className="mx-auto h-6 w-52 tree-skeleton animate-shimmer rounded" />
      <div className="space-y-2">
        <div className="mx-auto h-4 w-full tree-skeleton animate-shimmer rounded" />
        <div className="mx-auto h-4 w-4/5 tree-skeleton animate-shimmer rounded" />
      </div>
      <div className="mx-auto h-11 w-full tree-skeleton animate-shimmer rounded-full" />
    </div>
  )
}

/** Lets a signed-in visitor request viewer access to a private tree. */
export function AccessRequestPanel({
  treeId,
  treeName,
  email,
  onRequestUpdated,
  headingLevel = "h2",
  sidebar = false,
  formId,
  onFormStateChange,
}: {
  treeId: string
  treeName: string | null
  email: string
  onRequestUpdated?: () => void
  headingLevel?: "h1" | "h2"
  sidebar?: boolean
  formId?: string
  onFormStateChange?: (formState: AccessRequestFormState) => void
}) {
  const { status, submitting, submit } = useAccessRequest(treeId)
  const [comment, setComment] = useState("")
  const [editing, setEditing] = useState(false)

  const isPending =
    status.kind === "present" && status.request.status === "pending"
  const isApproved =
    status.kind === "present" && status.request.status === "approved"
  const isDenied =
    status.kind === "present" && status.request.status === "denied"
  const showForm = status.kind === "none" || editing
  const Heading = headingLevel

  useEffect(() => {
    onFormStateChange?.({
      active: showForm,
      canSubmit: showForm && !submitting && !!comment.trim(),
      submitting,
    })
  }, [comment, onFormStateChange, showForm, submitting])

  function startEditing(prefill: string) {
    setComment(prefill)
    setEditing(true)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = comment.trim()
    if (!trimmed) return
    const succeeded = await submit(trimmed)
    if (succeeded) {
      setComment("")
      setEditing(false)
      onRequestUpdated?.()
    }
  }

  return (
    <div className={`text-left ${sidebar ? "animate-slide-up pl-1" : ""}`}>
      <Heading
        className={
          sidebar
            ? "text-base font-semibold tracking-tight text-slate-800"
            : "text-center text-lg font-semibold text-[#27241f]"
        }
      >
        {treeName
          ? `Request access to "${treeName}"`
          : "Request access to this tree"}
      </Heading>
      <p
        className={
          sidebar
            ? "mt-1 text-xs leading-relaxed text-slate-400"
            : "mt-1 text-center text-sm text-[#686155]"
        }
      >
        You&apos;re signed in as{" "}
        <span className="font-medium text-[#27241f]">{email}</span>.
        {sidebar ? (
          <>
            <br />
            The owner will review your request.
          </>
        ) : (
          " Send a request and the owner will review it."
        )}
      </p>

      {status.kind === "loading" ? (
        <div className="mt-5">
          <AccessRequestSkeleton />
        </div>
      ) : isPending && !editing ? (
        <div className="mt-5">
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Request sent. Waiting for the owner to approve. You&apos;ll see the
              tree once approved.
            </span>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
            &ldquo;{status.request.comment}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => startEditing(status.request.comment)}
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-medium text-cobalt-600 ring-1 ring-cobalt-200 transition-all hover:bg-cobalt-50 active:scale-95"
          >
            Edit your message
          </button>
        </div>
      ) : isApproved && !editing ? (
        <div className="mt-5">
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            <span>Approved. Opening your tree…</span>
          </div>
        </div>
      ) : isDenied && !editing ? (
        <div className="mt-5">
          <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700 ring-1 ring-red-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Your access request was declined.</span>
          </div>
          <button
            type="button"
            onClick={() => startEditing(status.request.comment)}
            className="mt-3 w-full rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95"
          >
            Request again
          </button>
        </div>
      ) : showForm ? (
        <form
          id={formId}
          onSubmit={onSubmit}
          className="mt-5"
        >
          <label
            htmlFor="access-request-comment"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Who are you?
          </label>
          <textarea
            id="access-request-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="e.g. I'm John's cousin from Boston"
            rows={3}
            maxLength={500}
            required
            className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-200"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              {comment.length}/500
            </span>
            {!sidebar && (
              <button
                type="submit"
                disabled={submitting || !comment.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Send request
              </button>
            )}
          </div>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setComment("")
                setEditing(false)
              }}
              className="mt-2 w-full text-center text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
            >
              Cancel
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
