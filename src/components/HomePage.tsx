import {
  ArrowRight,
  Loader2,
  Network,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { authClient, useSession } from "../lib/auth-client"
import {
  countMembers,
  seedData,
  type TreeIndexStore,
  type TreeMeta,
  useHydrated,
} from "../store"
import { AccountMenu } from "./AccountMenu"
import { useConfirm } from "./Confirm"
import { LandingPage } from "./LandingPage"
import { ShareDialog } from "./ShareDialog"
import { useToast } from "./Toast"

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-cobalt-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
const ghostBtn =
  "inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:scale-95"

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?"
}

function TreeCard({
  tree,
  navigate,
  onRename,
  onDelete,
  onShare,
}: {
  tree: TreeMeta
  navigate: (to: string) => void
  onRename: (name: string) => void
  onDelete: () => Promise<void>
  onShare: () => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState(tree.name)
  const members = countMembers(tree.id)
  const created = new Date(tree.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  function submitRename(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed && trimmed !== tree.name) onRename(trimmed)
    setRenaming(false)
  }

  return (
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-cobalt-300 hover:shadow-soft sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-sm font-semibold text-cobalt-700">
          {initialFor(tree.name)}
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={submitRename}
              className="flex gap-2"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={submitRename}
                className={inputCls}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => navigate(`/tree/${tree.id}`)}
              className="block truncate text-left font-semibold text-slate-900 transition-colors hover:text-cobalt-700"
            >
              {tree.name}
            </button>
          )}
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {members} {members === 1 ? "member" : "members"} · created {created}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => navigate(`/tree/${tree.id}`)}
          className={`${primaryBtn} flex-1`}
        >
          Open <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Share tree"
          onClick={onShare}
          className={ghostBtn}
        >
          <Share2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Rename tree"
          onClick={() => {
            setName(tree.name)
            setRenaming(true)
          }}
          className={ghostBtn}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Delete tree"
          onClick={async () => {
            if (
              await confirm({
                title: "Delete tree",
                message: `Delete "${tree.name}" and its ${members} members? This cannot be undone.`,
                confirmText: "Delete",
                tone: "danger",
              })
            ) {
              setDeleting(true)
              try {
                await onDelete()
              } catch (error) {
                console.error(error)
                toast("Couldn't delete tree.", "error")
                setDeleting(false)
              }
            }
          }}
          disabled={deleting}
          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}

function SharedTreeCard({
  tree,
  navigate,
}: {
  tree: TreeMeta
  navigate: (to: string) => void
}) {
  const members = countMembers(tree.id)
  const role = tree.role === "editor" ? "editor" : "viewer"
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-cobalt-300 hover:shadow-soft">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
          {initialFor(tree.name)}
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/tree/${tree.id}`)}
            className="block truncate text-left text-sm font-semibold text-slate-900 transition-colors hover:text-cobalt-700"
          >
            {tree.name}
          </button>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {members} {members === 1 ? "member" : "members"}
            {tree.ownerEmail ? <> · from {tree.ownerEmail}</> : null}
          </p>
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
          role === "editor"
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
        }`}
      >
        {role}
      </span>
    </div>
  )
}

type SearchStatus = "idle" | "loading" | "done" | "error"

function PersonSearch({
  navigate,
  treeNameById,
}: {
  navigate: (to: string) => void
  treeNameById: Map<string, string>
}) {
  const [query, setQuery] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [matches, setMatches] = useState<
    Array<{ personId: string; name: string; treeId: string }>
  >([])
  const [status, setStatus] = useState<SearchStatus>("idle")

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (searchQuery.length < 3) {
      setMatches([])
      setStatus("idle")
      return
    }
    const controller = new AbortController()
    setStatus("loading")
    void fetch(`/api/people/search?query=${encodeURIComponent(searchQuery)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`search failed: ${response.status}`)
        return (await response.json()) as {
          results: Array<{ personId: string; name: string; treeId: string }>
        }
      })
      .then((body) => {
        setMatches(body.results)
        setStatus("done")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        console.error(error)
        setStatus("error")
      })
    return () => controller.abort()
  }, [searchQuery])

  const loading = status === "loading"
  const showPanel =
    searchQuery.length >= 3
    && (matches.length > 0 || status === "done" || status === "error")

  return (
    <div className="relative w-full">
      {loading ? (
        <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
      ) : (
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people…"
        className={`${inputCls} pl-9`}
      />
      {showPanel ? (
        <ul className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lift">
          {status === "error" ? (
            <li className="px-3 py-3 text-sm text-red-600">
              Couldn't load results. Try again.
            </li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">No matches.</li>
          ) : (
            matches.map((result) => (
              <li key={result.personId}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("")
                    navigate(`/tree/${result.treeId}/p/${result.personId}`)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-cobalt-50"
                >
                  <span className="truncate font-medium text-slate-800">
                    {result.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {treeNameById.get(result.treeId) ?? ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

function NewTreeDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled above) is the keyboard equivalent
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md animate-scale-in rounded-2xl border border-slate-200 bg-white p-6 shadow-lift">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-800">
              New tree
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Give your family tree a name — you can rename it anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-4"
        >
          <label
            htmlFor="new-tree-name-input"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Tree name
          </label>
          <input
            ref={inputRef}
            id="new-tree-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Tan Family"
            className={`${inputCls} mt-1.5`}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className={primaryBtn}
            >
              Create tree
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function HomePage({ index }: { index: TreeIndexStore }) {
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const { trees, createTree, renameTree, deleteTree } = index
  const [newTreeOpen, setNewTreeOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<TreeMeta | null>(null)
  const router = useRouter()
  const navigate = (to: string) => router.push(to)

  const own = useMemo(
    () => trees.filter((t) => t.role !== "viewer" && t.role !== "editor"),
    [trees],
  )
  const shared = useMemo(
    () => trees.filter((t) => t.role === "viewer" || t.role === "editor"),
    [trees],
  )
  const treeNameById = useMemo(
    () => new Map(trees.map((tree) => [tree.id, tree.name] as const)),
    [trees],
  )
  const totalPeople = useMemo(
    () => trees.reduce((sum, tree) => sum + countMembers(tree.id), 0),
    [trees],
  )

  function createWithName(trimmed: string) {
    setNewTreeOpen(false)
    navigate(`/tree/${createTree(trimmed)}`)
  }

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
  } else {
    body = (
      <>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Your family trees
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {trees.length} {trees.length === 1 ? "tree" : "trees"} ·{" "}
              {totalPeople} {totalPeople === 1 ? "person" : "people"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewTreeOpen(true)}
            className={`${primaryBtn} shrink-0`}
          >
            <Plus className="h-4 w-4" /> New tree
          </button>
        </div>

        <div className="mt-8">
          {trees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cobalt-50 text-cobalt-600">
                <Network className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-slate-700">
                No family trees yet
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Create one to get started, or try a small example.
              </p>
              <button
                type="button"
                onClick={() =>
                  navigate(`/tree/${createTree("Sample Family", seedData())}`)
                }
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-cobalt-700 ring-1 ring-cobalt-200 transition-all hover:bg-cobalt-50 active:scale-95"
              >
                <Sparkles className="h-4 w-4" /> Create sample tree
              </button>
            </div>
          ) : (
            <>
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Your trees
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {own.map((tree) => (
                    <TreeCard
                      key={tree.id}
                      tree={tree}
                      navigate={navigate}
                      onRename={(n) => renameTree(tree.id, n)}
                      onDelete={() => deleteTree(tree.id)}
                      onShare={() => setShareTarget(tree)}
                    />
                  ))}
                </div>
              </section>

              {shared.length > 0 && (
                <section className="mt-8">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Shared with you
                  </h2>
                  <div className="space-y-3">
                    {shared.map((tree) => (
                      <SharedTreeCard
                        key={tree.id}
                        tree={tree}
                        navigate={navigate}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {shareTarget && (
          <ShareDialog
            treeId={shareTarget.id}
            treeName={shareTarget.name}
            onClose={() => setShareTarget(null)}
          />
        )}

        {newTreeOpen && (
          <NewTreeDialog
            onClose={() => setNewTreeOpen(false)}
            onCreate={createWithName}
          />
        )}
      </>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
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
          <div className="mx-auto w-full min-w-0 max-w-md">
            <PersonSearch
              navigate={navigate}
              treeNameById={treeNameById}
            />
          </div>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {body}
      </main>
    </div>
  )
}
