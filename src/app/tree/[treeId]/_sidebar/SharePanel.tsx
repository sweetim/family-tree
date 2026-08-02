import { Copy, Loader2, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { RoleSelect } from "@/components/RoleSelect"
import { useToast } from "@/components/Toast"
import { useShares } from "@/lib/shares"
import { inputCls, labelCls, primaryBtn, sidebarFormIds } from "./shared"

function initialFor(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?"
}

function roleTextClass(role: "viewer" | "editor") {
  return role === "editor" ? "text-emerald-600" : "text-cobalt-600"
}

/**
 * Sidebar panel version of tree sharing for the tree's owner. Mirrors
 * ShareDialog's functionality (invite by email + role, revoke) using the
 * shared useShares hook, styled to match other sidebar panels.
 */
export function SharePanel({
  treeId,
  treeName,
}: {
  treeId: string
  treeName: string
}) {
  const {
    shares,
    loading,
    adding,
    submittingEmail,
    submittingMutation,
    add,
    updateRole,
    remove,
  } = useShares(treeId)
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
      <p className="text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-700">{treeName}</span> is only
        available to people you add below.
      </p>

      <div className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <label
          htmlFor="share-link-input"
          className={labelCls}
        >
          Copy tree link
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
            className={`${primaryBtn} shrink-0 px-3`}
          >
            <Copy className="h-4 w-4" /> Copy
          </button>
        </div>
      </div>

      <form
        id={sidebarFormIds.shareInvite}
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
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-200">
            <RoleSelect
              value={role}
              disabled={adding}
              loading={false}
              label="Invitation access"
              allowNone={false}
              onChange={(next) => {
                if (next) setRole(next)
              }}
            />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${roleTextClass(role)}`}>
                {role === "editor" ? "Editor" : "Viewer"}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {role === "editor"
                  ? "Can add and edit people"
                  : "Read-only access"}
              </p>
            </div>
          </div>
        </div>
      </form>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          People with access
        </h3>
        {loading ? (
          <div
            className="space-y-2"
            aria-busy="true"
            aria-live="polite"
          >
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
              >
                <div className="h-9 w-9 shrink-0 tree-skeleton animate-shimmer rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 tree-skeleton animate-shimmer rounded" />
                  <div className="h-2.5 w-1/4 tree-skeleton animate-shimmer rounded" />
                </div>
                <div className="h-8 w-8 tree-skeleton animate-shimmer rounded-full" />
                <div className="h-9 w-9 tree-skeleton animate-shimmer rounded-lg" />
              </div>
            ))}
          </div>
        ) : shares.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
            Not shared with anyone yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <li
                key={share.email}
                className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cobalt-50 text-xs font-semibold text-cobalt-700">
                  {initialFor(share.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">
                    {share.email}
                  </p>
                  <p
                    className={`text-[11px] font-semibold ${roleTextClass(share.role)}`}
                  >
                    {share.role === "editor" ? "Editor" : "Viewer"}
                  </p>
                </div>
                <RoleSelect
                  value={share.role}
                  disabled={submittingEmail !== null}
                  loading={
                    submittingEmail === share.email
                    && submittingMutation === "update"
                  }
                  label={`Access for ${share.email}`}
                  allowNone={false}
                  onChange={(next) => {
                    if (next) void updateRole(share.email, next)
                  }}
                />
                <button
                  type="button"
                  onClick={() => remove(share.email)}
                  disabled={submittingEmail !== null}
                  title="Revoke access"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  {submittingEmail === share.email
                  && submittingMutation === "remove" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
