import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/components/Toast"

export type RequestState = "pending" | "approved" | "denied"

export type MyAccessRequest = {
  status: RequestState
  comment: string
  createdAt: string
}

export type RequestStatus =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "present"; request: MyAccessRequest }

/**
 * A requester's view of their own access request for a tree. `status` drives
 * the request card: `loading` while fetching, `none` when no request exists
 * (show the form), or `present` to show the pending/denied state.
 */
export function useAccessRequest(treeId: string) {
  const toast = useToast()
  const [status, setStatus] = useState<RequestStatus>({ kind: "loading" })
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setStatus({ kind: "loading" })
    try {
      const res = await fetch(`/api/trees/${treeId}/access-request`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const data = (await res.json()) as { request: MyAccessRequest | null }
      setStatus(
        data.request
          ? { kind: "present", request: data.request }
          : { kind: "none" },
      )
    } catch (err) {
      console.error(err)
      setStatus({ kind: "none" })
    }
  }, [treeId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = useCallback(
    async (comment: string): Promise<boolean> => {
      setSubmitting(true)
      try {
        const res = await fetch(`/api/trees/${treeId}/access-request`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(err.error ?? `submit failed: ${res.status}`)
        }
        await refresh()
        return true
      } catch (err) {
        console.error(err)
        toast(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't send request.",
          "error",
        )
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [treeId, refresh, toast],
  )

  return { status, submitting, submit, refresh }
}

export type OwnerAccessRequest = {
  userId: string
  email: string
  name: string
  comment: string
  createdAt: string
}

/**
 * Owner-side list of pending access requests for a tree, with approve/deny.
 * Used by the ShareDialog's "Access requests" section.
 */
export function useOwnerAccessRequests(treeId: string) {
  const toast = useToast()
  const [requests, setRequests] = useState<OwnerAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/trees/${treeId}/access-requests`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const data = (await res.json()) as { requests: OwnerAccessRequest[] }
      setRequests(data.requests)
    } catch (err) {
      console.error(err)
      toast("Couldn't load access requests.", "error")
    } finally {
      setLoading(false)
    }
  }, [treeId, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const resolve = useCallback(
    async (userId: string, action: "approve" | "deny"): Promise<void> => {
      setSubmitting(true)
      try {
        const res = await fetch(`/api/trees/${treeId}/access-requests`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(err.error ?? `resolve failed: ${res.status}`)
        }
        toast(
          action === "approve"
            ? "Access approved — viewer access granted."
            : "Request declined.",
          "success",
        )
        await refresh()
      } catch (err) {
        console.error(err)
        toast(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't resolve request.",
          "error",
        )
      } finally {
        setSubmitting(false)
      }
    },
    [treeId, refresh, toast],
  )

  return { requests, loading, submitting, resolve, refresh }
}
