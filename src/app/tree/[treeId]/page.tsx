"use client"

import { CheckCircle2, Loader2 } from "lucide-react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { useAccessRequest } from "@/lib/access-requests"
import { authClient, useSession } from "@/lib/auth-client"
import { useHydrated, useTreeIndex } from "@/store"
import { TreeView } from "./_tree/TreeView"

export default function TreePage() {
  const params = useParams<{ treeId: string }>()
  const index = useTreeIndex()
  const tree = index.trees.find((t) => t.id === params?.treeId)
  if (tree) {
    return (
      <TreeView
        key={tree.id}
        tree={tree}
        allTrees={index.trees}
      />
    )
  }
  return <TreeNotFound />
}

/**
 * Shown when the tree id isn't loaded. A signed-out visitor may have access
 * once they authenticate; a signed-in visitor whose initial pull has finished
 * simply doesn't have the tree.
 */
function TreeNotFound() {
  const params = useParams<{ treeId: string }>()
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const pathname = usePathname()

  if (isPending) return null

  if (!session?.user) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold text-slate-800">
          Sign in to request access
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          This family tree was shared with you. Sign in to continue — if you
          don&apos;t have access yet, you can request it afterwards. An account
          is created on your first sign-in.
        </p>
        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: pathname,
            })
          }
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
        >
          <GoogleIcon />
          Sign in with Google
        </button>
      </CenteredCard>
    )
  }

  if (!hydrated) {
    return (
      <CenteredCard>
        <p className="text-sm text-slate-500">Loading…</p>
      </CenteredCard>
    )
  }

  return (
    <CenteredCard>
      <RequestAccessCard
        treeId={params?.treeId ?? ""}
        email={session.user.email}
      />
      <BackHome />
    </CenteredCard>
  )
}

function BackHome() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push("/")}
      className="mt-5 inline-flex items-center justify-center rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95"
    >
      Back to home
    </button>
  )
}

/**
 * Shown to a signed-in user without access to the tree. Lets them request
 * viewer access and attach a short note about who they are, which the owner
 * reviews. Reflects pending/denied states, and allows editing/re-requesting.
 */
function RequestAccessCard({
  treeId,
  email,
}: {
  treeId: string
  email: string
}) {
  const { status, submitting, submit } = useAccessRequest(treeId)
  const [comment, setComment] = useState("")
  const [editing, setEditing] = useState(false)

  const isPending =
    status.kind === "present" && status.request.status === "pending"
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
      setComment("")
      setEditing(false)
    }
  }

  return (
    <div className="text-left">
      <h1 className="text-center text-lg font-semibold text-slate-800">
        Request access to this tree
      </h1>
      <p className="mt-1 text-center text-sm text-slate-500">
        You&apos;re signed in as{" "}
        <span className="font-medium text-slate-700">{email}</span>. Send a
        request and the owner will review it.
      </p>

      {status.kind === "loading" ? (
        <div className="mt-5 flex justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
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
      ) : isDenied && !editing ? (
        <div className="mt-5">
          <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700 ring-1 ring-red-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
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

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-soft">
        {children}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}
