"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { ConfirmProvider } from "@/components/Confirm"
import { ToastProvider } from "@/components/Toast"
import { useSession } from "@/lib/auth-client"
import { applyRemote, resetStore, setHydrated } from "@/store"
import type { SyncPullResponse } from "@/sync/types"

const EPOCH = "1970-01-01T00:00:00.000Z"

/**
 * Hydrates the in-memory store from the server when a session is present, and
 * clears it on sign-out so a previous user's data does not leak. Rendered once
 * inside Providers so it only runs after mount (client-only).
 */
function ServerDataBootstrap() {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? null
  const prevId = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) {
      if (prevId.current !== null) resetStore()
      prevId.current = null
      return
    }
    prevId.current = userId

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/sync?since=${encodeURIComponent(EPOCH)}`,
          {
            credentials: "include",
          },
        )
        if (!res.ok) return
        const data = (await res.json()) as SyncPullResponse
        if (cancelled) return
        applyRemote({ persons: data.own.persons, trees: data.own.trees })
        for (const shared of data.shared) {
          applyRemote({ persons: shared.persons, trees: [shared.tree] })
        }
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
