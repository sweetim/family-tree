"use client"

import { usePathname } from "next/navigation"
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ConfirmProvider } from "@/components/Confirm"
import { ToastProvider } from "@/components/Toast"
import { useSession } from "@/lib/auth-client"
import { TreeEditModeProvider, useTreeEditMode } from "@/lib/tree-edit-mode"
import {
  applyTreeManifest,
  applyTreeSnapshot,
  fetchTreeManifest,
  fetchTreeSnapshot,
  resetStore,
  restorePersistentStore,
  setHydrated,
  synchronizePending,
  synchronizeTree,
} from "@/store"
import { bootstrapTreeSync } from "./bootstrap-tree-sync"

/**
 * Hydrates the in-memory store from the server when a session is present, and
 * clears it on sign-out so a previous user's data does not leak. Rendered once
 * inside Providers so it only runs after mount (client-only).
 */
function ServerDataBootstrap() {
  const { data: session } = useSession()
  const { editingTreeId } = useTreeEditMode()
  const userId = session?.user?.id ?? null
  const pathname = usePathname()
  const previousUserId = useRef<string | null | undefined>(undefined)

  const treeId = useMemo(() => {
    const match = pathname.match(/^\/tree\/([^/]+)/)
    if (!match?.[1]) return undefined
    try {
      return decodeURIComponent(match[1])
    } catch {
      return undefined
    }
  }, [pathname])

  useLayoutEffect(() => {
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
      let retryDelay = 500
      while (!cancelled) {
        try {
          await bootstrapTreeSync({
            treeId,
            restore: () => restorePersistentStore(userId),
            synchronize: synchronizePending,
            fetchManifest: fetchTreeManifest,
            applyManifest: applyTreeManifest,
            fetchSnapshot: fetchTreeSnapshot,
            applySnapshot: applyTreeSnapshot,
            markHydrated: () => setHydrated(true),
            isCancelled: () => cancelled,
          })
          return
        } catch (error) {
          const status =
            error && typeof error === "object" && "status" in error
              ? error.status
              : undefined
          if (status === 404) {
            if (!cancelled) setHydrated(true)
            return
          }
          console.error("initial sync pull failed", error)
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
          retryDelay = Math.min(retryDelay * 2, 10_000)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [treeId, userId])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const synchronize = () => {
      void synchronizePending()
      if (!treeId || editingTreeId !== treeId) return
      void fetchTreeManifest()
        .then((manifest) => {
          if (!cancelled) applyTreeManifest(manifest)
        })
        .catch(console.error)
      void synchronizeTree(treeId)
    }
    const interval = window.setInterval(synchronize, 15_000)
    window.addEventListener("online", synchronize)
    window.addEventListener("focus", synchronize)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("online", synchronize)
      window.removeEventListener("focus", synchronize)
    }
  }, [editingTreeId, treeId, userId])

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
        <TreeEditModeProvider>
          <ServerDataBootstrap />
          {children}
        </TreeEditModeProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}
