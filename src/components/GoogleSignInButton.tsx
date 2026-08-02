"use client"

import { Loader2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { GoogleIcon } from "./icons"

type Variant = "outline" | "hero" | "landing"
type Size = "default" | "lg"

type Props = {
  variant?: Variant
  size?: Size
  label?: string
  callbackURL?: string
  trailingIcon?: ReactNode
  className?: string
}

const VARIANT_CLASSES: Record<Variant, string> = {
  outline:
    "bg-white text-slate-800 ring-1 ring-slate-200 shadow-sm hover:bg-slate-50",
  hero: "bg-cobalt-600 text-white shadow-[0_15px_35px_rgba(31,65,224,0.2)] hover:bg-cobalt-700 hover:shadow-[0_18px_40px_rgba(27,52,189,0.24)]",
  landing:
    "bg-white text-cobalt-700 shadow-[0_16px_40px_rgba(2,6,23,0.28)] hover:bg-cobalt-50 hover:text-cobalt-800 hover:shadow-[0_20px_48px_rgba(2,6,23,0.34)]",
}

const SIZE_CLASSES: Record<Size, string> = {
  default: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-sm sm:px-6 sm:py-3.5",
}

/**
 * The single sign-in entry point. Every "Sign in with Google" affordance in
 * the app routes through here so the visual treatment, click behavior, and
 * post-click redirecting state stay consistent across surfaces.
 */
export function GoogleSignInButton({
  variant = "outline",
  size = "default",
  label = "Sign in with Google",
  callbackURL,
  trailingIcon,
  className = "",
}: Props) {
  const [redirecting, setRedirecting] = useState(false)

  return (
    <button
      type="button"
      disabled={redirecting}
      onClick={() => {
        setRedirecting(true)
        void authClient.signIn.social({
          provider: "google",
          ...(callbackURL ? { callbackURL } : {}),
        })
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600 focus-visible:ring-offset-2 active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-70 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${trailingIcon ? "group" : ""} ${className}`}
    >
      {redirecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <GoogleIcon />
      )}
      <span>{redirecting ? "Redirecting…" : label}</span>
      {trailingIcon ? (
        <span className="transition-transform group-hover:translate-x-1">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  )
}
