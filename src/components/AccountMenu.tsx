import {
  Check,
  ChevronDown,
  CloudOff,
  LoaderCircle,
  LogOut,
  TriangleAlert,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { authClient, useSession } from "../lib/auth-client"
import {
  resolveNextSyncConflict,
  useSyncConflictCount,
  useSyncStatus,
} from "../store"
import { GoogleIcon } from "./icons"

/**
 * Account menu — Sign in with Google when signed out, an avatar dropdown when
 * signed in. Sign-in is required to view trees; this is the entry point.
 */
export function AccountMenu() {
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
  const syncStatus = useSyncStatus()
  const conflictCount = useSyncConflictCount()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onClick)
    return () => window.removeEventListener("mousedown", onClick)
  }, [open])

  if (isPending) {
    return (
      <div className="h-9 w-9 tree-skeleton animate-shimmer rounded-full" />
    )
  }

  // A malformed session payload (e.g. an HTML body served where JSON was
  // expected) can be truthy yet lack a `user` — treat it as signed-out.
  if (!session?.user) {
    return (
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "google" })}
        className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
      >
        <GoogleIcon />
        Sign in
      </button>
    )
  }

  const initial = session.user.name?.[0]?.toUpperCase() ?? "?"

  const syncState = {
    saved: {
      icon: <Check className="h-3.5 w-3.5 text-emerald-500" />,
      label: "All changes saved",
    },
    saving: {
      icon: (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-slate-400" />
      ),
      label: "Saving…",
    },
    offline: {
      icon: <CloudOff className="h-3.5 w-3.5 text-slate-400" />,
      label: "Offline",
    },
    conflict: {
      icon: <TriangleAlert className="h-3.5 w-3.5 text-red-500" />,
      label: "Sync conflict",
    },
  }[syncStatus]

  return (
    <div
      ref={ref}
      className="relative shrink-0"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-2 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
      >
        <span className="relative inline-block">
          {session.user.image ? (
            // biome-ignore lint/performance/noImgElement: external OAuth avatar URL with unknown dimensions
            <img
              src={session.user.image}
              alt=""
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cobalt-600 text-xs font-semibold text-white">
              {initial}
            </span>
          )}
          <span
            title={`Sync: ${syncStatus}`}
            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
              syncStatus === "saved"
                ? "bg-emerald-500"
                : syncStatus === "saving"
                  ? "bg-amber-400"
                  : "bg-red-500"
            }`}
          />
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lift">
          <div className="flex items-center gap-2 px-3 py-2">
            {session.user.image ? (
              // biome-ignore lint/performance/noImgElement: external OAuth avatar URL with unknown dimensions
              <img
                src={session.user.image}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cobalt-600 text-xs font-semibold text-white">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">
                {session.user.name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {session.user.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2 text-xs text-slate-500">
            {syncState.icon}
            <span>{syncState.label}</span>
          </div>
          {conflictCount > 0 ? (
            <div className="mx-1 mb-1 rounded-xl bg-amber-50 p-2 text-xs text-amber-900">
              <p>
                {conflictCount} alternate offline{" "}
                {conflictCount === 1 ? "edit" : "edits"} retained.
              </p>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => resolveNextSyncConflict("current")}
                  className="rounded-lg bg-white px-2 py-1 ring-1 ring-amber-200"
                >
                  Keep current
                </button>
                <button
                  type="button"
                  onClick={() => resolveNextSyncConflict("alternate")}
                  className="rounded-lg bg-amber-600 px-2 py-1 text-white"
                >
                  Use other edit
                </button>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              authClient.signOut()
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
