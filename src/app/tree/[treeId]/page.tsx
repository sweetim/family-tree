"use client"

import { useParams, usePathname, useRouter } from "next/navigation"
import { authClient, useSession } from "@/lib/auth-client"
import { useHydrated, useTreeIndex } from "@/store"
import { TreeView } from "@/TreeView"

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
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const pathname = usePathname()

  if (isPending) return null

  if (!session?.user) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold text-slate-800">
          Sign in to view this tree
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          This family tree may have been shared with you. Sign in to access it.
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
      <h1 className="text-lg font-semibold text-slate-800">
        This tree isn’t available
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        It may have been deleted, or it hasn’t been shared with you.
      </p>
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
