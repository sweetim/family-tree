import {
  ArrowLeft,
  Check,
  Loader2,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react"
import { useSession } from "../lib/auth-client"
import { useOwnedAccessRequests } from "../lib/access-requests"
import { useOwnerShares } from "../lib/shares"
import { type TreeIndexStore, useHydrated } from "../store"
import { AccountMenu } from "./AccountMenu"
import { useConfirm } from "./Confirm"
import { LandingPage } from "./LandingPage"
import { ROLE_ICON, ROLE_OPTIONS, RoleSelect, type RoleValue } from "./RoleSelect"
import { useToast } from "./Toast"
import { inputCls, primaryBtn } from "./ui"

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


type Row = {
  email: string
  name: string | null
  pending: boolean
  access: Map<string, "viewer" | "editor">
}

function SharingMatrixSkeleton() {
  return (
    <div className="scroll-area overflow-x-auto">
      <div className="min-w-[32rem]">
        <div className="flex border-b border-slate-200 bg-slate-50/80">
          <div className="w-64 shrink-0 border-r border-slate-200 px-4 py-3">
            <div className="h-3 w-12 tree-skeleton animate-shimmer rounded" />
          </div>
          {[1, 2, 3].map((column) => (
            <div
              key={column}
              className="flex min-w-[5.5rem] flex-1 flex-col items-center gap-1.5 px-2 py-2.5"
            >
              <div className="h-7 w-7 tree-skeleton animate-shimmer rounded-lg" />
              <div className="h-3 w-14 tree-skeleton animate-shimmer rounded" />
            </div>
          ))}
        </div>
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex border-b border-slate-100 last:border-b-0"
          >
            <div className="flex w-64 shrink-0 items-center gap-2.5 border-r border-slate-100 px-4 py-3">
              <div className="h-9 w-9 shrink-0 tree-skeleton animate-shimmer rounded-full" />
              <div className="space-y-1.5">
                <div className="h-3.5 w-28 tree-skeleton animate-shimmer rounded" />
                <div className="h-3 w-20 tree-skeleton animate-shimmer rounded" />
              </div>
            </div>
            {[1, 2, 3].map((column) => (
              <div
                key={column}
                className="flex min-w-[5.5rem] flex-1 items-center justify-center px-2 py-2"
              >
                <div className="h-8 w-16 tree-skeleton animate-shimmer rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SharingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-3 w-16 tree-skeleton animate-shimmer rounded"
          />
        ))}
      </div>
      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <div className="h-3 w-28 tree-skeleton animate-shimmer rounded" />
        <div className="mt-2 flex gap-2">
          <div className="h-10 flex-1 tree-skeleton animate-shimmer rounded-lg" />
          <div className="h-10 w-28 tree-skeleton animate-shimmer rounded-lg" />
        </div>
        <div className="mt-2 h-3 w-64 tree-skeleton animate-shimmer rounded" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <SharingMatrixSkeleton />
      </div>
    </div>
  )
}

function AccessRequestsSkeleton() {
  return (
    <div
      className="space-y-2"
      aria-busy="true"
    >
      {[1].map((item) => (
          <div
            key={item}
            className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200"
          >
          <div className="h-4 w-2/5 tree-skeleton animate-shimmer rounded" />
          <div className="mt-1.5 h-3 w-1/3 tree-skeleton animate-shimmer rounded" />
          <div className="mt-3 h-4 w-4/5 tree-skeleton animate-shimmer rounded" />
          <div className="mt-3 flex gap-2">
            <div className="h-8 flex-1 tree-skeleton animate-shimmer rounded-lg" />
            <div className="h-8 flex-1 tree-skeleton animate-shimmer rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
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
  const {
    entries,
    loading,
    setRole,
    removePerson: removeOwnerPerson,
    refresh: refreshOwnerShares,
  } = useOwnerShares()
  const {
    requests,
    pendingCount,
    loading: requestsLoading,
    resolve: resolveRequest,
  } = useOwnedAccessRequests()
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
    (
      email: string,
      tree: { id: string; name: string },
      next: "viewer" | "editor" | null,
    ) => {
      setOp(`role:${email}:${tree.id}`)
      void setRole(email, tree, next).finally(() => setOp(null))
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
        const removed = await removeOwnerPerson(row.email, row.access.keys())
        if (removed) {
          setDrafts((prev) => prev.filter((email) => email !== row.email))
          toast(`Removed "${displayName}".`, "success")
        }
      } finally {
        setOp(null)
      }
    },
    [confirm, removeOwnerPerson, toast],
  )

  const busy = op !== null
  const peopleCount = entries.length
  const treeCount = ownTrees.length

  let body: ReactNode
  if (isPending || !hydrated) {
    body = <SharingSkeleton />
  } else if (!session?.user) {
    return <LandingPage />
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

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Access requests
            </h2>
            {pendingCount > 0 ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
                {pendingCount} pending
              </span>
            ) : null}
          </div>
          {requestsLoading ? (
            <AccessRequestsSkeleton />
          ) : requests.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No pending access requests.
            </p>
          ) : (
            <ul className="space-y-2">
              {requests.map((request) => (
                <li
                  key={`${request.treeId}:${request.userId}`}
                  className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {request.name || request.email}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {request.treeName}
                      </p>
                    </div>
                    {request.name && request.name !== request.email ? (
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {request.email}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    “{request.comment}”
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOp(`approve:${request.treeId}:${request.userId}`)
                        void resolveRequest(
                          request.treeId,
                          request.userId,
                          "approve",
                        )
                          .then(async (ok) => {
                            if (ok) await refreshOwnerShares()
                          })
                          .finally(() => setOp(null))
                      }}
                      disabled={
                        op === `approve:${request.treeId}:${request.userId}`
                        || op === `deny:${request.treeId}:${request.userId}`
                      }
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                    >
                      {op ===
                      `approve:${request.treeId}:${request.userId}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}{" "}
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOp(`deny:${request.treeId}:${request.userId}`)
                        void resolveRequest(
                          request.treeId,
                          request.userId,
                          "deny",
                        ).finally(() => setOp(null))
                      }}
                      disabled={
                        op === `approve:${request.treeId}:${request.userId}`
                        || op === `deny:${request.treeId}:${request.userId}`
                      }
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-all hover:bg-red-50 active:scale-95 disabled:opacity-50"
                    >
                      {op ===
                      `deny:${request.treeId}:${request.userId}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}{" "}
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
            <SharingMatrixSkeleton />
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
                                  changeRole(row.email, tree, next)
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
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <Image
              src="/logo.webp"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-cover"
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
              {isPending || !hydrated || loading ? (
                <span className="inline-block h-4 w-28 tree-skeleton animate-shimmer rounded align-middle" />
              ) : (
                <>
                  {peopleCount} {peopleCount === 1 ? "person" : "people"} ·{" "}
                  {treeCount} {treeCount === 1 ? "tree" : "trees"}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-8">{body}</div>
      </main>
    </div>
  )
}
