import { Check, Loader2, Trash2, UserPlus, X } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useState } from "react"
import { useOwnerShares } from "@/lib/shares"
import { useToast } from "./Toast"

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
const cellSelectCls =
  "w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-semibold focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"

type Row = {
  email: string
  name: string | null
  pending: boolean
  access: Map<string, "viewer" | "editor">
}

function selectTone(role: "viewer" | "editor" | undefined) {
  if (role === "editor") return "text-emerald-700"
  if (role === "viewer") return "text-cobalt-700"
  return "text-slate-400"
}

/**
 * Owner modal for cross-tree sharing, rendered as a people × trees access
 * matrix. Each cell is a 3-state role control (— / Viewer / Editor) that
 * grants, updates, or revokes that person's access to that tree immediately.
 * An "Add person" row creates a draft row you configure by setting cells.
 */
export function SharingDialog({
  ownTrees,
  onClose,
}: {
  ownTrees: { id: string; name: string }[]
  onClose: () => void
}) {
  const { entries, loading, submitting, setRole } = useOwnerShares()
  const toast = useToast()
  const [drafts, setDrafts] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState("")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const rows = useMemo<Row[]>(() => {
    const known = new Set(entries.map((entry) => entry.email))
    return [
      ...entries.map((entry) => ({
        email: entry.email,
        name: entry.name,
        pending: entry.pending,
        access: new Map(
          entry.trees.map((tree) => [tree.treeId, tree.role] as const),
        ),
      })),
      ...drafts
        .filter((email) => !known.has(email))
        .map((email) => ({
          email,
          name: null,
          pending: false,
          access: new Map<string, "viewer" | "editor">(),
        })),
    ]
  }, [entries, drafts])

  function addPerson(e: FormEvent) {
    e.preventDefault()
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    if (rows.some((row) => row.email === trimmed)) {
      toast("That person is already listed.", "info")
      return
    }
    setDrafts((prev) => [...prev, trimmed])
    setNewEmail("")
  }

  async function removePerson(row: Row) {
    for (const treeId of row.access.keys()) {
      await setRole(row.email, treeId, null)
    }
    setDrafts((prev) => prev.filter((email) => email !== row.email))
  }

  const busy = submitting
  const isEmpty = ownTrees.length === 0

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled above) is the keyboard equivalent
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift animate-scale-in">
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-6 pb-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-800">
              Sharing
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Grant or revoke each person's access to each tree. A dash means no
              access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-auto p-6 pt-4">
          {isEmpty ? (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              You don't own any trees yet. Create one to start sharing.
            </p>
          ) : loading && rows.length === 0 ? (
            <div className="flex justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-48 min-w-[12rem] border-b border-slate-200 bg-white px-2 pb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Person
                  </th>
                  {ownTrees.map((tree) => (
                    <th
                      key={tree.id}
                      className="border-b border-slate-200 px-2 pb-2 text-center text-xs font-semibold text-slate-600"
                    >
                      <span
                        className="block max-w-[8rem] truncate"
                        title={tree.name}
                      >
                        {tree.name}
                      </span>
                    </th>
                  ))}
                  <th className="w-9 border-b border-slate-200 bg-white" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.email}>
                    <td className="sticky left-0 z-10 truncate border-b border-slate-100 bg-white px-2 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {row.name || row.email}
                          </p>
                          {row.name && row.name !== row.email ? (
                            <p className="truncate text-[11px] text-slate-400">
                              {row.email}
                            </p>
                          ) : null}
                          <span
                            className={`mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                              row.pending
                                ? "bg-amber-50 text-amber-700 ring-amber-200"
                                : "bg-cobalt-50 text-cobalt-700 ring-cobalt-200"
                            }`}
                          >
                            {row.pending ? (
                              "Pending"
                            ) : (
                              <>
                                <Check className="h-2.5 w-2.5" /> Active
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </td>
                    {ownTrees.map((tree) => {
                      const role = row.access.get(tree.id)
                      return (
                        <td
                          key={tree.id}
                          className="border-b border-slate-100 px-1.5 py-1.5 text-center"
                        >
                          <select
                            value={role ?? ""}
                            onChange={(event) => {
                              const value = event.target.value
                              void setRole(
                                row.email,
                                tree.id,
                                value === ""
                                  ? null
                                  : (value as "viewer" | "editor"),
                              )
                            }}
                            disabled={busy}
                            aria-label={`Access to ${tree.name}`}
                            className={`${cellSelectCls} ${selectTone(role)}`}
                          >
                            <option value="">—</option>
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                        </td>
                      )
                    })}
                    <td className="border-b border-slate-100 bg-white px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => void removePerson(row)}
                        disabled={busy}
                        title="Remove person"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}

                <tr>
                  <td
                    colSpan={ownTrees.length + 2}
                    className="bg-white px-2 pt-3"
                  >
                    <form
                      onSubmit={addPerson}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        placeholder="Add a person by email…"
                        className={inputCls}
                      />
                      <button
                        type="submit"
                        disabled={busy || !newEmail.trim()}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <UserPlus className="h-4 w-4" /> Add
                      </button>
                    </form>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
