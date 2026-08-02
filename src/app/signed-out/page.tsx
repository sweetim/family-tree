"use client"

import { useEffect } from "react"
import { LandingPage } from "@/components/LandingPage"
import { authClient } from "@/lib/auth-client"

export default function SignedOutPage() {
  useEffect(() => {
    void authClient.signOut()
  }, [])

  return <LandingPage />
}
