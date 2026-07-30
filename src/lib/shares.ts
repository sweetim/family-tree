import { useEffect, useState } from "react"
import { useToast } from "@/components/Toast"

export type Share = {
  email: string
  role: "viewer" | "editor"
}

/**
 * Loads and manages a tree's share list for its owner. Shared by the HomePage
 * ShareDialog modal and the sidebar SharePanel so the API logic lives once.
 * Returns `true` from `add` when the invite succeeded so callers can clear
 * their email input.
 */
export function useShares(treeId: string) {
  const toast = useToast()
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const loaded: Share[] = []
      let cursor: string | undefined
      do {
        const parameters = new URLSearchParams({ limit: "100" })
        if (cursor) parameters.set("cursor", cursor)
        const res = await fetch(
          `/api/trees/${encodeURIComponent(treeId)}/shares?${parameters}`,
          { credentials: "include" },
        )
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const data = (await res.json()) as {
          shares: Share[]
          nextCursor?: string
        }
        loaded.push(...data.shares)
        cursor = data.nextCursor
      } while (cursor)
      setShares(loaded)
    } catch (err) {
      console.error(err)
      toast("Couldn't load shares.", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [treeId])

  async function add(
    email: string,
    role: "viewer" | "editor",
  ): Promise<boolean> {
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/trees/${encodeURIComponent(treeId)}/shares`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        },
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `add failed: ${res.status}`)
      }
      await refresh()
      return true
    } catch (err) {
      console.error(err)
      toast(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't add share.",
        "error",
      )
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(targetEmail: string) {
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/trees/${encodeURIComponent(treeId)}/shares?email=${encodeURIComponent(targetEmail)}`,
        { method: "DELETE", credentials: "include" },
      )
      if (!res.ok) throw new Error(`remove failed: ${res.status}`)
      await refresh()
    } catch (err) {
      console.error(err)
      toast("Couldn't remove share.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  return { shares, loading, submitting, add, remove }
}
