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
export function useAccessRequest(treeId: string | undefined) {
  const toast = useToast()
  const [status, setStatus] = useState<RequestStatus>(() =>
    treeId ? { kind: "loading" } : { kind: "none" },
  )
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    if (!treeId) return
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
      if (!treeId) return false
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

export type RequestedTree = {
  treeId: string
  treeName: string
  status: RequestState
  comment: string
  createdAt: string
}

/**
 * One-shot list of the signed-in user's own access requests (across all
 * trees), for Home. Not polled — refreshed when Home remounts. `loading`
 * lets the caller hold the dashboard on its skeleton until the requests
 * have landed, so pending-access cards don't pop in after the grid. Gated
 * on `enabled` (session presence) so signed-out visitors skip the fetch.
 */
export function useMyAccessRequests(enabled: boolean): {
  requests: RequestedTree[]
  loading: boolean
} {
  const [requests, setRequests] = useState<RequestedTree[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    void fetch("/api/my-access-requests", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        return (await res.json()) as { requests: RequestedTree[] }
      })
      .then((data) => {
        setRequests(data.requests)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error(err)
        setLoading(false)
      })
    return () => controller.abort()
  }, [enabled])
  return { requests, loading }
}

export type OwnerAccessRequest = {
  userId: string
  email: string
  name: string
  comment: string
  createdAt: string
}

export type OwnedAccessRequest = OwnerAccessRequest & {
  treeId: string
  treeName: string
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
      const loaded: OwnerAccessRequest[] = []
      let cursor: string | undefined
      do {
        const parameters = new URLSearchParams({ limit: "100" })
        if (cursor) parameters.set("cursor", cursor)
        const res = await fetch(
          `/api/trees/${encodeURIComponent(treeId)}/access-requests?${parameters}`,
          { credentials: "include" },
        )
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const data = (await res.json()) as {
          requests: OwnerAccessRequest[]
          nextCursor?: string
        }
        loaded.push(...data.requests)
        cursor = data.nextCursor
      } while (cursor)
      setRequests(loaded)
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
    async (userId: string, action: "approve" | "deny"): Promise<boolean> => {
      setSubmitting(true)
      try {
        const res = await fetch(
          `/api/trees/${encodeURIComponent(treeId)}/access-requests`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, action }),
          },
        )
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
        return true
      } catch (err) {
        console.error(err)
        toast(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't resolve request.",
          "error",
        )
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [treeId, refresh, toast],
  )

  return { requests, loading, submitting, resolve, refresh }
}

/** Pending access requests across every tree owned by the signed-in user. */
export function useOwnedAccessRequests() {
  const toast = useToast()
  const [requests, setRequests] = useState<OwnedAccessRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded: OwnedAccessRequest[] = []
      let cursor: string | undefined
      let count = 0
      do {
        const parameters = new URLSearchParams({ limit: "100" })
        if (cursor) parameters.set("cursor", cursor)
        const res = await fetch(`/api/access-requests?${parameters}`, {
          credentials: "include",
        })
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const data = (await res.json()) as {
          requests: OwnedAccessRequest[]
          pendingCount: number
          nextCursor?: string
        }
        loaded.push(...data.requests)
        count = data.pendingCount
        cursor = data.nextCursor
      } while (cursor)
      setRequests(loaded)
      setPendingCount(count)
    } catch (err) {
      console.error(err)
      toast("Couldn't load access requests.", "error")
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const resolve = useCallback(
    async (
      treeId: string,
      userId: string,
      action: "approve" | "deny",
    ): Promise<boolean> => {
      setSubmitting(true)
      try {
        const res = await fetch(
          `/api/trees/${encodeURIComponent(treeId)}/access-requests`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, action }),
          },
        )
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
        return true
      } catch (err) {
        console.error(err)
        toast(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't resolve request.",
          "error",
        )
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [refresh, toast],
  )

  return { requests, pendingCount, loading, submitting, resolve, refresh }
}

/** Lightweight pending-request total for the Sharing navigation badge. */
export function useOwnedAccessRequestCount(enabled: boolean) {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setPendingCount(0)
      return
    }

    const controller = new AbortController()
    void fetch("/api/access-requests?limit=1", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        return (await res.json()) as { pendingCount: number }
      })
      .then((data) => setPendingCount(data.pendingCount))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error(err)
      })
    return () => controller.abort()
  }, [enabled])

  return pendingCount
}
