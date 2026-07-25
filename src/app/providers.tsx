"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { ConfirmProvider } from "@/components/Confirm"
import { ToastProvider } from "@/components/Toast"
import { useSession } from "@/lib/auth-client"
import { applyFullPull, fetchFullPull, resetStore, setHydrated } from "@/store"

/**
 * Hydrates the in-memory store from the server when a session is present, and
 * clears it on sign-out so a previous user's data does not leak. Rendered once
 * inside Providers so it only runs after mount (client-only).
 */
function ServerDataBootstrap() {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? null
  const previousUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (previousUserId.current !== userId) {
      resetStore()
      previousUserId.current = userId
    }
    if (!userId) {
      setHydrated(true)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const data = await fetchFullPull()
        if (cancelled) return
        applyFullPull(data)
        setHydrated(true)
      } catch (err) {
        console.error("initial sync pull failed", err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [userId])

  return null
}

/**
 * App-wide providers + server-data bootstrap. Renders nothing until mounted on
 * the client: the store fetches from the server at runtime (no meaningful SSR
 * output), and gating here avoids hydration mismatches across all pages in one
 * place.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return (
    <ToastProvider>
      <ConfirmProvider>
        <ServerDataBootstrap />
        {children}
      </ConfirmProvider>
    </ToastProvider>
  )
}
