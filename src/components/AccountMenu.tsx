import { ChevronDown, LogOut, User } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { authClient, useSession } from "../lib/auth-client"

/**
 * Account menu — Sign in with Google when signed out, an avatar dropdown when
 * signed in. Sign-in is required to view trees; this is the entry point.
 */
export function AccountMenu() {
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
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
    return <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
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

  return (
    <div
      ref={ref}
      className="relative"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-2 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
      >
        <span className="relative inline-block">
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
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
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lift">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <User className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">
                {session.user.name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {session.user.email}
              </p>
            </div>
          </div>
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
