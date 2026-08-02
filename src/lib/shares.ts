import { useEffect, useRef, useState } from "react"
import { useToast } from "@/components/Toast"

export type Share = {
  email: string
  role: "viewer" | "editor"
}

type ShareMutation = "update" | "remove"

export type OwnerShareEntry = {
  email: string
  name: string | null
  pending: boolean
  trees: { treeId: string; treeName: string; role: "viewer" | "editor" }[]
}

type OwnerShareChange = {
  email: string
  treeId: string
  treeName?: string
  role: "viewer" | "editor" | null
  name?: string | null
  pending?: boolean
}

type OwnerShareMutationResponse = {
  changes: Omit<OwnerShareChange, "treeName">[]
}

function applyOwnerShareChanges(
  entries: OwnerShareEntry[],
  changes: OwnerShareChange[],
): OwnerShareEntry[] {
  const changedByEmail = new Map<string, OwnerShareChange[]>()
  for (const change of changes) {
    const personChanges = changedByEmail.get(change.email) ?? []
    personChanges.push(change)
    changedByEmail.set(change.email, personChanges)
  }

  const updated = entries
    .map((entry) => {
      const personChanges = changedByEmail.get(entry.email)
      if (!personChanges) return entry
      const trees = new Map(entry.trees.map((tree) => [tree.treeId, tree]))
      for (const change of personChanges) {
        if (change.role === null) {
          trees.delete(change.treeId)
        } else {
          trees.set(change.treeId, {
            treeId: change.treeId,
            treeName:
              change.treeName ?? trees.get(change.treeId)?.treeName ?? "",
            role: change.role,
          })
        }
      }
      const latestGrant = personChanges
        .slice()
        .reverse()
        .find((change) => change.role !== null)
      return trees.size > 0
        ? {
            ...entry,
            ...(latestGrant?.name !== undefined
              ? { name: latestGrant.name }
              : {}),
            ...(latestGrant?.pending !== undefined
              ? { pending: latestGrant.pending }
              : {}),
            trees: [...trees.values()],
          }
        : undefined
    })
    .filter((entry): entry is OwnerShareEntry => !!entry)

  for (const [email, personChanges] of changedByEmail) {
    if (entries.some((entry) => entry.email === email)) continue
    const grants = personChanges.filter(
      (change): change is OwnerShareChange & { role: "viewer" | "editor" } =>
        change.role !== null,
    )
    if (grants.length === 0) continue
    updated.push({
      email,
      name: grants.at(-1)?.name ?? null,
      pending: grants.at(-1)?.pending ?? true,
      trees: grants.map((change) => ({
        treeId: change.treeId,
        treeName: change.treeName ?? "",
        role: change.role,
      })),
    })
  }
  return updated
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
  const [adding, setAdding] = useState(false)
  const [submittingEmail, setSubmittingEmail] = useState<string | null>(null)
  const [submittingMutation, setSubmittingMutation] =
    useState<ShareMutation | null>(null)
  const refreshVersion = useRef(0)
  const submitting = adding || submittingEmail !== null

  async function refresh() {
    const currentRefresh = ++refreshVersion.current
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
      if (currentRefresh === refreshVersion.current) setShares(loaded)
    } catch (err) {
      console.error(err)
      if (currentRefresh === refreshVersion.current)
        toast("Couldn't load shares.", "error")
    }
  }

  useEffect(() => {
    let current = true
    setLoading(true)
    void refresh().finally(() => {
      if (current) setLoading(false)
    })
    return () => {
      current = false
    }
  }, [treeId])

  async function saveShare(
    email: string,
    role: "viewer" | "editor",
    fallbackError: string,
    mutation: "add" | "update",
  ): Promise<boolean> {
    if (mutation === "add") {
      setAdding(true)
    } else {
      setSubmittingEmail(email)
      setSubmittingMutation(mutation)
    }
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
        err instanceof Error && err.message ? err.message : fallbackError,
        "error",
      )
      return false
    } finally {
      if (mutation === "add") {
        setAdding(false)
      } else {
        setSubmittingEmail(null)
        setSubmittingMutation(null)
      }
    }
  }

  function add(email: string, role: "viewer" | "editor") {
    return saveShare(email, role, "Couldn't add share.", "add")
  }

  function updateRole(email: string, role: "viewer" | "editor") {
    return saveShare(email, role, "Couldn't update access.", "update")
  }

  async function remove(targetEmail: string) {
    setSubmittingEmail(targetEmail)
    setSubmittingMutation("remove")
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
      setSubmittingEmail(null)
      setSubmittingMutation(null)
    }
  }

  return {
    shares,
    loading,
    submitting,
    adding,
    submittingEmail,
    submittingMutation,
    add,
    updateRole,
    remove,
    refresh,
  }
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
      const loaded: OwnerShareEntry[] = []
      let cursor: string | undefined
      do {
        const parameters = new URLSearchParams({ limit: "100" })
        if (cursor) parameters.set("cursor", cursor)
        const res = await fetch(`/api/shares?${parameters}`, {
          credentials: "include",
        })
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const data = (await res.json()) as {
          entries: OwnerShareEntry[]
          nextCursor?: string
        }
        loaded.push(...data.entries)
        cursor = data.nextCursor
      } while (cursor)
      setEntries(loaded)
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

  async function applyChanges(changes: OwnerShareChange[]): Promise<boolean> {
    const previousEntries = entries
    setSubmitting(true)
    setEntries((current) => applyOwnerShareChanges(current, changes))
    try {
      const res = await fetch("/api/shares", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: changes.map(({ email, treeId, role }) => ({
            email,
            treeId,
            role,
          })),
        }),
      })
      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error.error ?? `update failed: ${res.status}`)
      }
      const data = (await res.json()) as OwnerShareMutationResponse
      const resultsByKey = new Map(
        data.changes.map((change) => [
          `${change.email}:${change.treeId}`,
          change,
        ]),
      )
      setEntries((current) =>
        applyOwnerShareChanges(
          current,
          changes.map((change) => ({
            ...change,
            ...resultsByKey.get(`${change.email}:${change.treeId}`),
          })),
        ),
      )
      return true
    } catch (err) {
      console.error(err)
      setEntries(previousEntries)
      toast(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't update access.",
        "error",
      )
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function setRole(
    email: string,
    tree: { id: string; name: string },
    role: "viewer" | "editor" | null,
  ) {
    return applyChanges([{ email, treeId: tree.id, treeName: tree.name, role }])
  }

  function removePerson(email: string, treeIds: Iterable<string>) {
    const changes = [...treeIds].map((treeId) => ({
      email,
      treeId,
      role: null,
    }))
    return changes.length > 0 ? applyChanges(changes) : Promise.resolve(true)
  }

  return { entries, loading, submitting, refresh, setRole, removePerson }
}
