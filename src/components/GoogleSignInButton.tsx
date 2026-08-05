"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { GoogleIcon } from "./icons"

type Label = "Sign in with Google" | "Sign up with Google" | "Continue with Google"

type Props = {
  label?: Label
  callbackURL?: string
  className?: string
}

/**
 * The single sign-in entry point. Every "Sign in with Google" affordance in
 * the app routes through here so Google branding and click behavior remain
 * consistent across surfaces.
 */
export function GoogleSignInButton({
  label = "Sign in with Google",
  callbackURL,
  className = "",
}: Props) {
  const [redirecting, setRedirecting] = useState(false)

  return (
    <button
      type="button"
      disabled={redirecting}
      aria-busy={redirecting}
      onClick={() => {
        setRedirecting(true)
        void authClient.signIn.social({
          provider: "google",
          ...(callbackURL ? { callbackURL } : {}),
        })
      }}
      className={`inline-flex min-h-10 items-center justify-center gap-2.5 rounded-full border border-[#747775] bg-white px-3 font-['Google_Sans',Arial,sans-serif] text-sm font-medium leading-5 text-[#1f1f1f] transition-colors hover:bg-[#f8fafd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b57d0] disabled:pointer-events-none disabled:opacity-70 ${className}`}
    >
      <GoogleIcon />
      <span>{label}</span>
    </button>
  )
}
