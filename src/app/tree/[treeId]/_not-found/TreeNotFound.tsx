"use client"

import { CheckCircle2, CircleAlert, Loader2, Mail } from "lucide-react"
import Image from "next/image"
import { useParams, usePathname, useRouter } from "next/navigation"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { GoogleSignInButton } from "@/components/GoogleSignInButton"
import { useToast } from "@/components/Toast"
import { useAccessRequest } from "@/lib/access-requests"
import { useSession } from "@/lib/auth-client"
import { useHydrated } from "@/store"

/**
 * Shown when the tree id isn't loaded. A signed-out visitor may have access
 * once they authenticate; a signed-in visitor whose initial pull has finished
 * simply doesn't have the tree. Shared by the tree and person pages so a deep
 * link to `/tree/[id]/p/[personId]` gets the same fallback as `/tree/[id]`.
 */
export function TreeNotFound() {
  const params = useParams<{ treeId: string }>()
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const pathname = usePathname()
  const treeName = useTreeInviteInfo(params?.treeId)

  if (isPending) {
    return (
      <CenteredCard>
        <AccessRequestSkeleton />
      </CenteredCard>
    )
  }

  if (!session?.user) {
    return (
      <CenteredCard>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-cobalt-50 text-cobalt-600 ring-1 ring-cobalt-100">
          <Mail className="h-5 w-5" />
        </div>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cobalt-600">
          You&apos;re invited
        </p>
        <h1 className="mt-2 text-[1.75rem] font-bold leading-none tracking-[-0.045em] text-[#27241f]">
          {treeName ?? "A family tree"}
        </h1>
        {treeName ? (
          <p className="mt-1 text-sm font-medium text-[#9b9384]">Family tree</p>
        ) : null}
        <p className="mt-4 text-sm leading-6 text-[#686155]">
          Sign in to see the people and stories shared with you.
        </p>
        <GoogleSignInButton
          label="Continue with Google"
          callbackURL={pathname}
          className="mt-6 w-full"
        />
      </CenteredCard>
    )
  }

  if (!hydrated) {
    return (
      <CenteredCard>
        <AccessRequestSkeleton />
      </CenteredCard>
    )
  }

  return (
    <CenteredCard>
      <RequestAccessCard
        treeId={params?.treeId ?? ""}
        treeName={treeName}
        email={session.user.email}
      />
      <BackHome />
    </CenteredCard>
  )
}

/**
 * Fetches the public name of the tree referenced by the current route so the
 * invite card can say which family the visitor was invited to. Returns null
 * until resolved or if the tree is unknown.
 */
function useTreeInviteInfo(treeId: string | undefined): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    if (!treeId) return
    let cancelled = false
    void fetch(`/api/trees/${encodeURIComponent(treeId)}/invite`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.name === "string") setName(data.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [treeId])
  return name
}

function AccessRequestSkeleton() {
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

function BackHome() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push("/")}
      className="mt-5 w-full rounded-full bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95"
    >
      Back to home
    </button>
  )
}

/**
 * Shown to a signed-in user without access to the tree. Lets them request
 * viewer access and attach a short note about who they are, which the owner
 * reviews. Reflects pending/approved/denied states, and allows
 * editing/re-requesting.
 */
function RequestAccessCard({
  treeId,
  treeName,
  email,
}: {
  treeId: string
  treeName: string | null
  email: string
}) {
  const { status, submitting, submit } = useAccessRequest(treeId)
  const toast = useToast()
  const [comment, setComment] = useState("")
  const [editing, setEditing] = useState(false)

  const isPending =
    status.kind === "present" && status.request.status === "pending"
  const isApproved =
    status.kind === "present" && status.request.status === "approved"
  const isDenied =
    status.kind === "present" && status.request.status === "denied"
  const showForm = status.kind === "none" || editing

  function startEditing(prefill: string) {
    setComment(prefill)
    setEditing(true)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = comment.trim()
    if (!trimmed) return
    const ok = await submit(trimmed)
    if (ok) {
      toast("Access request sent — the owner will review it.", "success")
      setComment("")
      setEditing(false)
    }
  }

  return (
    <div className="text-left">
      <h1 className="text-center text-lg font-semibold text-[#27241f]">
        {treeName
          ? `Request access to "${treeName}"`
          : "Request access to this tree"}
      </h1>
      <p className="mt-1 text-center text-sm text-[#686155]">
        You&apos;re signed in as{" "}
        <span className="font-medium text-[#27241f]">{email}</span>. Send a
        request and the owner will review it.
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
              Request sent — waiting for the owner to approve. You&apos;ll see
              the tree here once approved.
            </span>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
            “{status.request.comment}”
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
            <span>Approved — opening your tree…</span>
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
            placeholder="e.g. I'm John's cousin from Penang"
            rows={3}
            maxLength={500}
            required
            className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-200"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              {comment.length}/500
            </span>
            <button
              type="submit"
              disabled={submitting || !comment.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send request
            </button>
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

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f7f4ed] p-5 text-[#27241f] sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <Image
            src="/logo.webp"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <span className="text-lg font-bold tracking-[-0.04em]">FamiKi</span>
        </div>
        <div className="rounded-[1.75rem] border border-white/80 bg-white/95 p-6 text-center shadow-[0_28px_70px_rgba(47,39,27,0.11)] backdrop-blur sm:p-7">
          {children}
        </div>
      </div>
    </div>
  )
}
