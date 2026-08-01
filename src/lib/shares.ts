import { useEffect, useState } from "react"
import { useToast } from "@/components/Toast"

export type Share = {
  email: string
  role: "viewer" | "editor"
}

export type OwnerShareEntry = {
  email: string
  name: string | null
  pending: boolean
  trees: { treeId: string; treeName: string; role: "viewer" | "editor" }[]
}

/**
 * Adds a single email to one tree. Never throws — returns the outcome so a
 * batch caller can report per-tree failures. Used by the multi-tree invite UI.
 */
export async function addShareToTree(
  treeId: string,
  email: string,
  role: "viewer" | "editor",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/trees/${encodeURIComponent(treeId)}/shares`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: err.error ?? `add failed: ${res.status}` }
    }
    return { ok: true }
  } catch (error) {
    console.error(error)
    return { ok: false, error: "Couldn't add share." }
  }
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

/**
 * Loads an owner's sharing overview (every share across their trees, grouped
 * by email) for the HomePage "Sharing" matrix. `setRole` grants or updates a
 * role on one tree (passing `null` revokes it) and refreshes.
 */
export function useOwnerShares() {
  const toast = useToast()
  const [entries, setEntries] = useState<OwnerShareEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch("/api/shares", { credentials: "include" })
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const data = (await res.json()) as { entries: OwnerShareEntry[] }
      setEntries(data.entries)
    } catch (err) {
      console.error(err)
      toast("Couldn't load sharing overview.", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function setRole(
    email: string,
    treeId: string,
    role: "viewer" | "editor" | null,
  ) {
    setSubmitting(true)
    try {
      if (role === null) {
        const res = await fetch(
          `/api/trees/${encodeURIComponent(treeId)}/shares?email=${encodeURIComponent(email)}`,
          { method: "DELETE", credentials: "include" },
        )
        if (!res.ok) throw new Error(`remove failed: ${res.status}`)
      } else {
        const result = await addShareToTree(treeId, email, role)
        if (!result.ok) {
          toast(result.error, "error")
          return
        }
      }
      await refresh()
    } catch (err) {
      console.error(err)
      toast("Couldn't update access.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  return { entries, loading, submitting, refresh, setRole }
}
