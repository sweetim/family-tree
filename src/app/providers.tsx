"use client"

import { type ReactNode, useEffect, useState } from "react"
import { ConfirmProvider } from "@/components/Confirm"
import { ToastProvider } from "@/components/Toast"
import { useSession } from "@/lib/auth-client"
import { getSyncEngine } from "@/sync/engine"

/**
 * Starts/stops the sync engine with the session lifecycle. Rendered once
 * inside Providers so it only runs after mount (client-only).
 */
function SyncEngineBootstrap() {
  const { data: session } = useSession()
  useEffect(() => {
    if (!session) return
    const engine = getSyncEngine()
    engine.start()
    return () => engine.stop()
  }, [session])
  return null
}

/**
 * App-wide providers + sync bootstrap. Renders nothing until mounted on the
 * client: the store is localStorage-backed (no meaningful SSR output), and
 * gating here avoids hydration mismatches across all pages in one place.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return (
    <ToastProvider>
      <ConfirmProvider>
        <SyncEngineBootstrap />
        {children}
      </ConfirmProvider>
    </ToastProvider>
  )
}
