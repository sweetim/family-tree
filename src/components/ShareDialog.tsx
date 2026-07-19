import { Loader2, Trash2, X } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { useToast } from "./Toast"

interface Share {
  email: string
  userId: string | null
  role: "viewer" | "editor"
  pending: boolean
}

/**
 * Modal for a tree owner to manage shares. Lists current shares (with a
 * "pending" badge for emails that haven't signed in yet), and lets the owner
 * add a new email with viewer/editor role or revoke an existing share.
 */
export function ShareDialog({
  treeId,
  treeName,
  onClose,
}: {
  treeId: string
  treeName: string
  onClose: () => void
}) {
  const toast = useToast()
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"viewer" | "editor">("viewer")
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/trees/${treeId}/shares`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const data = (await res.json()) as { shares: Share[] }
      setShares(data.shares)
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

  async function add(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/trees/${treeId}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `add failed: ${res.status}`)
      }
      setEmail("")
      await refresh()
    } catch (err) {
      console.error(err)
      toast(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't add share.",
        "error",
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(targetEmail: string) {
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/trees/${treeId}/shares?email=${encodeURIComponent(targetEmail)}`,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-800">
              Share tree
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{treeName}</span> —
              anyone you add can open it from any device after signing in with
              the email below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={add}
          className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
        >
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Invite by email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="relative@example.com"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
            required
          />
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
            >
              <option value="viewer">Viewer (read-only)</option>
              <option value="editor">Editor (can add/edit people)</option>
            </select>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Editors can change this tree's people (and those changes flow back
            to the owner). Server enforces permissions regardless of UI state.
          </p>
        </form>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            People with access
          </h3>
          {loading ? (
            <div className="flex justify-center py-6 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : shares.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              Not shared with anyone yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {shares.map((share) => (
                <li
                  key={share.email}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {share.email}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      {share.role}
                      {share.pending ? " · pending sign-in" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(share.email)}
                    disabled={submitting}
                    title="Revoke access"
                    className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
