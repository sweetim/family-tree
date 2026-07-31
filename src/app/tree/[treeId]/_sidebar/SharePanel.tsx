import { Copy, Loader2, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { useToast } from "@/components/Toast"
import { useShares } from "@/lib/shares"
import { inputCls, labelCls, selectCls } from "./shared"

/**
 * Sidebar panel version of tree sharing for the tree's owner. Mirrors
 * ShareDialog's functionality (invite by email + role, revoke) using the
 * shared useShares hook, styled to match other sidebar panels.
 */
export function SharePanel({
  treeId,
  treeName,
  onClose,
}: {
  treeId: string
  treeName: string
  onClose: () => void
}) {
  const { shares, loading, submitting, add, remove } = useShares(treeId)
  const toast = useToast()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"viewer" | "editor">("viewer")
  const [shareUrl, setShareUrl] = useState("")

  useEffect(() => {
    setShareUrl(`${window.location.origin}/tree/${treeId}`)
  }, [treeId])

  async function onCopyLink() {
    if (!shareUrl) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        const textarea = document.createElement("textarea")
        textarea.value = shareUrl
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
      }
      toast("Link copied to clipboard.", "success")
    } catch (err) {
      console.error(err)
      toast("Couldn't copy link.", "error")
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    const ok = await add(trimmed, role)
    if (ok) setEmail("")
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Share tree</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-cobalt-600 transition-colors hover:text-cobalt-700"
        >
          Done
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-700">{treeName}</span> — anyone
        you add can open it from any device after signing in with the email
        below.
      </p>

      <div className="space-y-2">
        <label
          htmlFor="share-link-input"
          className={labelCls}
        >
          Share link
        </label>
        <div className="flex items-center gap-2">
          <input
            id="share-link-input"
            type="url"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="https://…"
            className={inputCls}
            aria-label="Tree share link"
          />
          <button
            type="button"
            onClick={onCopyLink}
            disabled={!shareUrl}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Copy
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Anyone you've shared with can use this link after signing in.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
      >
        <label
          htmlFor="share-email-input"
          className={labelCls}
        >
          Invite by email
        </label>
        <input
          id="share-email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="relative@example.com"
          className={inputCls}
          required
        />
        <div className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
            className={selectCls}
          >
            <option value="viewer">Viewer (read-only)</option>
            <option value="editor">Editor (can add/edit people)</option>
          </select>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Editors can change this tree's people (and those changes flow back to
          the owner). Server enforces permissions regardless of UI state.
        </p>
      </form>

      <div>
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
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(share.email)}
                  disabled={submitting}
                  title="Revoke access"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
