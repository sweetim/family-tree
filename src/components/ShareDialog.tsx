import { Loader2, Trash2, X } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { useShares } from "@/lib/shares"

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
  const { shares, loading, submitting, add, remove } = useShares(treeId)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"viewer" | "editor">("viewer")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    const ok = await add(trimmed, role)
    if (ok) setEmail("")
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled above) is the keyboard equivalent
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lift">
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
          onSubmit={onSubmit}
          className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
        >
          <label
            htmlFor="share-email-input"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Invite by email
          </label>
          <input
            id="share-email-input"
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
