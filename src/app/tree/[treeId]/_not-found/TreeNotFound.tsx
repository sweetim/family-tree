"use client"

import { Mail } from "lucide-react"
import Image from "next/image"
import { useParams, usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect, useState } from "react"
import {
  AccessRequestPanel,
  AccessRequestSkeleton,
} from "@/components/AccessRequestPanel"
import { GoogleSignInButton } from "@/components/GoogleSignInButton"
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
      <AccessRequestPanel
        treeId={params?.treeId ?? ""}
        treeName={treeName}
        email={session.user.email}
        headingLevel="h1"
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
