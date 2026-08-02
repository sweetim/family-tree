import {
  ArrowLeft,
  Ban,
  Check,
  Eye,
  Loader2,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { authClient, useSession } from "../lib/auth-client"
import { useOwnerShares } from "../lib/shares"
import { type TreeIndexStore, useHydrated } from "../store"
import { AccountMenu } from "./AccountMenu"
import { useConfirm } from "./Confirm"
import { LandingPage } from "./LandingPage"
import { useToast } from "./Toast"
import { inputCls, primaryBtn } from "./ui"

type RoleValue = "viewer" | "editor" | "none"

const ROLE_ICON: Record<RoleValue, typeof Eye> = {
  editor: Pencil,
  viewer: Eye,
  none: Ban,
}

const ROLE_OPTIONS: { value: RoleValue; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
]

function toneText(role: RoleValue) {
  if (role === "editor") return "text-emerald-600"
  if (role === "viewer") return "text-cobalt-600"
  return "text-slate-400"
}

function chipCls(role: RoleValue) {
  const ring = "ring-1"
  if (role === "editor")
    return `bg-emerald-50 ${ring} ring-emerald-200 text-emerald-600 hover:bg-emerald-100`
  if (role === "viewer")
    return `bg-cobalt-50 ${ring} ring-cobalt-200 text-cobalt-600 hover:bg-cobalt-100`
  return `bg-slate-50 ${ring} ring-slate-200 text-slate-400 hover:bg-slate-100`
}

/**
 * Custom 3-state role control for an access cell. Closed it shows just a
 * colored icon; opening reveals a portal-rendered menu (icon + label) so it
 * is never clipped by the table's scroll containers.
 */
function RoleSelect({
  value,
  disabled,
  loading,
  label,
  onChange,
}: {
  value: "viewer" | "editor" | undefined
  disabled: boolean
  loading: boolean
  label: string
  onChange: (role: "viewer" | "editor" | null) => void
}) {
  const current: RoleValue = value ?? "none"
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 176
    const menuHeight = 140
    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8)
      left = window.innerWidth - menuWidth - 8
    if (left < 8) left = 8
    let top = rect.bottom + 6
    if (top + menuHeight > window.innerHeight - 8)
      top = rect.top - menuHeight - 6
    if (top < 8) top = 8
    setCoords({ top, left })

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    function onScroll() {
      setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [open])

  const Icon = ROLE_ICON[current]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${ROLE_OPTIONS.find((option) => option.value === current)?.label}`}
        onClick={() => setOpen((previous) => !previous)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${chipCls(current)}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: coords.top, left: coords.left }}
              className="fixed z-50 w-44 animate-scale-in rounded-xl border border-slate-200 bg-white p-1 shadow-lift"
            >
              {ROLE_OPTIONS.map((option) => {
                const OptionIcon = ROLE_ICON[option.value]
                const isCurrent = option.value === current
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange(option.value === "none" ? null : option.value)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                      isCurrent ? "text-slate-900" : "text-slate-600"
                    }`}
                  >
                    <OptionIcon
                      className={`h-4 w-4 ${toneText(option.value)}`}
                    />
                    <span className="flex-1 font-medium">{option.label}</span>
                    {isCurrent ? (
                      <Check className="h-4 w-4 text-cobalt-600" />
                    ) : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

type Row = {
  email: string
  name: string | null
  pending: boolean
  access: Map<string, "viewer" | "editor">
}

function initialFor(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?"
}

/**
 * Full-page owner view for cross-tree sharing, rendered as a people × trees
 * access matrix. Each cell is a custom role control (No access / Viewer /
 * Editor) that grants, updates, or revokes that person's access to that tree
 * immediately. An "Invite someone" bar above the table adds a draft person.
 */
export function SharingPage({ index }: { index: TreeIndexStore }) {
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const { trees } = index
  const { entries, loading, setRole } = useOwnerShares()
  const confirm = useConfirm()
  const toast = useToast()
  const [drafts, setDrafts] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState("")

  const ownTrees = useMemo(
    () =>
      trees
        .filter((tree) => tree.role !== "viewer" && tree.role !== "editor")
        .map((tree) => ({ id: tree.id, name: tree.name })),
    [trees],
  )

  const rows = useMemo<Row[]>(() => {
    const known = new Set(entries.map((entry) => entry.email))
    const merged = [
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

    return merged.sort((left, right) => {
      const byName = (left.name ?? left.email).localeCompare(
        right.name ?? right.email,
        undefined,
        { sensitivity: "base" },
      )
      return (
        byName
        || left.email.localeCompare(right.email, undefined, {
          sensitivity: "base",
        })
      )
    })
  }, [entries, drafts])

  const addPerson = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const trimmed = newEmail.trim().toLowerCase()
      if (!trimmed) return
      if (rows.some((row) => row.email === trimmed)) {
        toast("That person is already listed.", "info")
        return
      }
      setDrafts((prev) => [...prev, trimmed])
      setNewEmail("")
    },
    [newEmail, rows, toast],
  )

  const [op, setOp] = useState<string | null>(null)

  const changeRole = useCallback(
    (email: string, treeId: string, next: "viewer" | "editor" | null) => {
      setOp(`role:${email}:${treeId}`)
      void setRole(email, treeId, next).finally(() => setOp(null))
    },
    [setRole],
  )

  const removePerson = useCallback(
    async (row: Row) => {
      const accessCount = row.access.size
      const displayName = row.name ?? row.email
      const confirmed = await confirm({
        title: "Remove person",
        message:
          accessCount === 0
            ? `Remove "${displayName}" from this list?`
            : `Remove "${displayName}" and revoke access to ${accessCount} ${accessCount === 1 ? "tree" : "trees"}?`,
        confirmText: "Remove",
        tone: "danger",
      })
      if (!confirmed) return

      setOp(`remove:${row.email}`)
      try {
        for (const treeId of row.access.keys()) {
          await setRole(row.email, treeId, null)
        }
        setDrafts((prev) => prev.filter((email) => email !== row.email))
      } finally {
        setOp(null)
      }
    },
    [confirm, setRole],
  )

  const busy = op !== null
  const peopleCount = entries.length
  const treeCount = ownTrees.length

  let body: ReactNode
  if (isPending || !hydrated) {
    body = (
      <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Loading…
      </p>
    )
  } else if (!session?.user) {
    return (
      <LandingPage
        onSignIn={() => authClient.signIn.social({ provider: "google" })}
      />
    )
  } else if (treeCount === 0) {
    body = (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-semibold text-slate-700">
          You don't own any trees yet
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Create a tree from the home page to start sharing.
        </p>
        <Link
          href="/"
          className={`${primaryBtn} mt-4`}
        >
          <ArrowLeft className="h-6 w-6" /> Home
        </Link>
      </div>
    )
  } else {
    body = (
      <div className="animate-fade-in space-y-6">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          {ROLE_OPTIONS.map((option) => {
            const LegendIcon = ROLE_ICON[option.value]
            return (
              <span
                key={option.value}
                className="inline-flex items-center gap-1.5"
              >
                <LegendIcon
                  className={`h-3.5 w-3.5 ${toneText(option.value)}`}
                />
                {option.label}
              </span>
            )
          })}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Active
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Pending sign-in
          </span>
        </div>

        {/* Invite bar */}
        <form
          onSubmit={addPerson}
          className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
        >
          <label
            htmlFor="sharing-email-input"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Invite someone
          </label>
          <div className="flex items-center gap-2">
            <input
              id="sharing-email-input"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="relative@example.com"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={busy || !newEmail.trim()}
              className={`${primaryBtn} shrink-0`}
            >
              <UserPlus className="h-4 w-4" /> Add person
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            They appear below — choose Viewer or Editor for each tree.
          </p>
        </form>

        {/* Matrix */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="scroll-area overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 w-60 min-w-[15rem] border-b border-r border-slate-200 bg-slate-50/80 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
                      Person
                    </th>
                    {ownTrees.map((tree) => (
                      <th
                        key={tree.id}
                        className="min-w-[5.5rem] border-b border-slate-200 bg-slate-50/80 px-2 py-2.5 text-center backdrop-blur"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cobalt-50 text-[11px] font-semibold text-cobalt-700">
                            {initialFor(tree.name)}
                          </span>
                          <span
                            className="block max-w-[7rem] truncate text-xs font-medium text-slate-600"
                            title={tree.name}
                          >
                            {tree.name}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.email}
                      className="group transition-colors hover:bg-slate-50/60"
                    >
                      <td className="sticky left-0 z-10 w-64 min-w-[16rem] border-b border-r border-slate-100 bg-white px-4 py-3 group-hover:bg-slate-50/60">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cobalt-50 text-xs font-semibold text-cobalt-700">
                            {initialFor(row.name || row.email)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {row.name || row.email}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  row.pending
                                    ? "bg-amber-400"
                                    : "bg-emerald-500"
                                }`}
                                title={
                                  row.pending ? "Pending sign-in" : "Active"
                                }
                              />
                              <span className="truncate text-[11px] text-slate-400">
                                {row.name && row.name !== row.email
                                  ? row.email
                                  : row.pending
                                    ? "Pending sign-in"
                                    : "Active"}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removePerson(row)}
                            disabled={busy}
                            title="Remove person"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                          >
                            {op === `remove:${row.email}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                      {ownTrees.map((tree) => {
                        const role = row.access.get(tree.id)
                        return (
                          <td
                            key={tree.id}
                            className="border-b border-slate-100 px-2 py-2 text-center"
                          >
                            <div className="flex justify-center">
                              <RoleSelect
                                value={role}
                                disabled={busy}
                                loading={op === `role:${row.email}:${tree.id}`}
                                label={`Access to ${tree.name}`}
                                onChange={(next) =>
                                  changeRole(row.email, tree.id, next)
                                }
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <Image
              src="/logo.webp"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
            />
            <span className="hidden text-base font-semibold tracking-tight text-slate-900 sm:inline">
              FamiKi
            </span>
          </Link>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-cobalt-700"
        >
          <ArrowLeft className="h-6 w-6" /> Home
        </Link>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Sharing
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {peopleCount} {peopleCount === 1 ? "person" : "people"} ·{" "}
              {treeCount} {treeCount === 1 ? "tree" : "trees"}
            </p>
          </div>
        </div>
        <div className="mt-8">{body}</div>
      </main>
    </div>
  )
}
