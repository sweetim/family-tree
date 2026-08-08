import {
  ArrowRight,
  Check,
  CloudOff,
  Loader2,
  Lock,
  Network,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  X,
} from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { match } from "ts-pattern"
import {
  type RequestedTree,
  useMyAccessRequests,
  useOwnedAccessRequestCount,
} from "../lib/access-requests"
import { useSession } from "../lib/auth-client"
import { gedcomToFamily } from "../lib/gedcom"
import {
  countMembers,
  normalizeImport,
  type SyncStatus,
  seedData,
  type TreeIndexStore,
  type TreeMeta,
  type TreeSeed,
  useHydrated,
  useSyncStatus,
  validateImportedFamily,
} from "../store"
import type { FamilyData } from "../types"
import { AccountMenu } from "./AccountMenu"
import { useConfirm } from "./Confirm"
import { LandingPage } from "./LandingPage"
import { Modal } from "./Modal"
import { ShareDialog } from "./ShareDialog"
import { useToast } from "./Toast"
import { inputCls, primaryBtn } from "./ui"

const ghostBtn =
  "inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:scale-95"

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?"
}

type TreeNameFieldHandle = {
  start: () => void
}

type TreeNameFieldProps = {
  tree: TreeMeta
  navigate: (to: string) => void
  onRename: (name: string) => void
}

/**
 * Inline-rename field for a tree's name. Owns the rename state machine
 * (editing, sync status, click-outside-to-close, auto-dismiss on saved) and
 * exposes a `start()` handle so the rename trigger button elsewhere in the
 * card can enter edit mode.
 */
function TreeNameField({
  ref,
  tree,
  navigate,
  onRename,
}: TreeNameFieldProps & { ref?: Ref<TreeNameFieldHandle> }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(tree.name)
  const [renameStatus, setRenameStatus] = useState<SyncStatus | null>(null)
  const renameFormRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const syncStatus = useSyncStatus()

  useImperativeHandle(
    ref,
    () => ({
      start: () => {
        setName(tree.name)
        setRenameStatus(null)
        setRenaming(true)
      },
    }),
    [tree.name],
  )

  function submitRename(e: FormEvent) {
    e.preventDefault()
    if (renameStatus === "saving") return
    const trimmed = name.trim()
    if (!trimmed || trimmed === tree.name) {
      setRenaming(false)
      setRenameStatus(null)
      return
    }
    onRename(trimmed)
    setRenameStatus("saving")
  }

  useEffect(() => {
    if (!renameStatus || renameStatus === "saved") return
    setRenameStatus(syncStatus)
  }, [renameStatus, syncStatus])

  useEffect(() => {
    if (renameStatus !== "saved") return
    const timeout = window.setTimeout(() => {
      setRenaming(false)
      setRenameStatus(null)
    }, 1200)
    return () => window.clearTimeout(timeout)
  }, [renameStatus])

  useEffect(() => {
    if (!renaming || renameStatus === "saving") return
    const closeWhenUnfocused = (event: MouseEvent) => {
      if (
        renameFormRef.current?.contains(event.target as Node)
        || document.activeElement === nameInputRef.current
      ) {
        return
      }
      setRenaming(false)
      setRenameStatus(null)
    }
    document.addEventListener("mousedown", closeWhenUnfocused)
    return () => document.removeEventListener("mousedown", closeWhenUnfocused)
  }, [renaming, renameStatus])

  const renameIndicator = match(renameStatus)
    .with("saving", () => ({
      icon: Loader2,
      label: "Saving",
      className: "text-slate-400",
      spin: true,
    }))
    .with("saved", () => ({
      icon: Check,
      label: "Saved",
      className: "text-emerald-600",
      spin: false,
    }))
    .with("offline", () => ({
      icon: CloudOff,
      label: "Offline",
      className: "text-amber-600",
      spin: false,
    }))
    .with("conflict", () => ({
      icon: TriangleAlert,
      label: "Sync conflict",
      className: "text-red-600",
      spin: false,
    }))
    .with(null, () => null)
    .exhaustive()

  if (renaming) {
    return (
      <form
        ref={renameFormRef}
        onSubmit={submitRename}
        className="relative"
      >
        <input
          ref={nameInputRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (renameStatus !== "saving") setRenameStatus(null)
          }}
          onBlur={submitRename}
          aria-label="Tree name"
          disabled={renameStatus === "saving"}
          className={`${inputCls} pr-32`}
        />
        {renameIndicator && (
          <span
            aria-live="polite"
            className={`pointer-events-none absolute inset-y-0 right-3 inline-flex items-center gap-1 text-xs font-medium ${renameIndicator.className}`}
          >
            <renameIndicator.icon
              className={`h-3.5 w-3.5 ${renameIndicator.spin ? "animate-spin" : ""}`}
            />
            {renameIndicator.label}
          </span>
        )}
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navigate(`/tree/${tree.id}`)}
      className="block truncate text-left font-semibold text-slate-900 transition-colors hover:text-cobalt-700"
    >
      {tree.name}
    </button>
  )
}

function TreeCard({
  tree,
  navigate,
  onRename,
  onDelete,
  onRemove,
  onShare,
}: {
  tree: TreeMeta
  navigate: (to: string) => void
  onRename: (name: string) => void
  onDelete: () => Promise<void>
  onRemove: () => void
  onShare: () => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const nameFieldRef = useRef<TreeNameFieldHandle>(null)
  const members = countMembers(tree.id)
  const isShared = tree.role === "viewer" || tree.role === "editor"
  const created = new Date(tree.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  return (
    <div
      className={`group flex flex-col rounded-xl border p-4 transition-all hover:shadow-soft sm:p-5 ${
        removing ? "animate-fade-out " : ""
      }${
        isShared
          ? "border-cobalt-200 bg-cobalt-50/40 hover:border-cobalt-300"
          : "border-slate-200 bg-white hover:border-cobalt-300"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
            isShared
              ? "bg-white text-cobalt-700 ring-1 ring-cobalt-200"
              : "bg-cobalt-50 text-cobalt-700"
          }`}
        >
          {initialFor(tree.name)}
        </span>
        <div className="min-w-0 flex-1">
          {isShared ? (
            <button
              type="button"
              onClick={() => navigate(`/tree/${tree.id}`)}
              className="block truncate text-left font-semibold text-slate-900 transition-colors hover:text-cobalt-700"
            >
              {tree.name}
            </button>
          ) : (
            <TreeNameField
              ref={nameFieldRef}
              tree={tree}
              navigate={navigate}
              onRename={onRename}
            />
          )}
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {members} {members === 1 ? "member" : "members"}
            {isShared ? (
              tree.ownerEmail ? (
                <> · shared by {tree.ownerEmail}</>
              ) : null
            ) : (
              <> · created {created}</>
            )}
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
        {!isShared && (
          <>
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
              onClick={() => nameFieldRef.current?.start()}
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
                    toast(`Deleted "${tree.name}".`, "success")
                    setRemoving(true)
                    window.setTimeout(onRemove, 200)
                  } catch (error) {
                    console.error(error)
                    toast("Couldn't delete tree.", "error")
                    setDeleting(false)
                  }
                }
              }}
              disabled={deleting || removing}
              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function NewTreeCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center transition-all hover:border-cobalt-400 hover:bg-cobalt-50/50 hover:shadow-soft active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-600 transition-colors group-hover:bg-cobalt-100 group-hover:text-cobalt-700">
        <Plus className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-800">New tree</p>
        <p className="mt-0.5 text-xs text-slate-500">Start a new family tree</p>
      </div>
    </button>
  )
}

function PendingAccessCard({
  request,
  navigate,
}: {
  request: RequestedTree
  navigate: (to: string) => void
}) {
  const { treeId, treeName, status, comment, createdAt } = request
  const requested = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  const tone = match(status)
    .with("pending", () => ({
      label: "Waiting for approval",
      className: "bg-amber-50 text-amber-700 ring-amber-200",
    }))
    .with("approved", () => ({
      label: "Approved",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    }))
    .with("denied", () => ({
      label: "Declined",
      className: "bg-red-50 text-red-700 ring-red-200",
    }))
    .exhaustive()
  return (
    <button
      type="button"
      onClick={() => navigate(`/tree/${treeId}`)}
      className="group relative flex min-h-[140px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-left transition-all hover:border-cobalt-300 hover:shadow-soft sm:p-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_10px,rgba(15,23,42,0.03)_10px,rgba(15,23,42,0.03)_11px)]"
      />
      <div className="relative flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-700">
            {treeName}
          </span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
            Access requested · {requested}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${tone.className}`}
        >
          {tone.label}
        </span>
      </div>
      <p className="relative mt-3 line-clamp-2 text-xs italic text-slate-500">
        &ldquo;{comment}&rdquo;
      </p>
      <span className="relative mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-cobalt-600">
        {status === "denied" ? "Request again" : "View request"}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}

function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-52 tree-skeleton animate-shimmer rounded" />
          <div className="h-4 w-32 tree-skeleton animate-shimmer rounded" />
        </div>
      </div>
      <div className="mt-8">
        <div className="mb-3 h-3 w-20 tree-skeleton animate-shimmer rounded" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 tree-skeleton animate-shimmer rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 tree-skeleton animate-shimmer rounded" />
                  <div className="h-3 w-1/2 tree-skeleton animate-shimmer rounded" />
                </div>
              </div>
              <div className="mt-4 h-9 w-full tree-skeleton animate-shimmer rounded-lg" />
            </div>
          ))}
        </div>
      </div>
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
    && (loading
      || matches.length > 0
      || status === "done"
      || status === "error")

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people…"
        className={`${inputCls} pl-9`}
      />
      {showPanel ? (
        <ul className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lift">
          {loading ? (
            <li
              className="space-y-2 px-3 py-3"
              aria-busy="true"
            >
              <div className="h-4 w-2/3 tree-skeleton animate-shimmer rounded" />
              <div className="h-4 w-1/2 tree-skeleton animate-shimmer rounded" />
            </li>
          ) : status === "error" ? (
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

/** Tree name fallback for an import: the filename without its extension, or a
 *  generic label when the filename has no usable characters. */
function deriveTreeName(filename: string): string {
  const stripped = filename.replace(/\.(json|ged|gedcom)$/i, "").trim()
  return stripped || "Imported tree"
}

/** Read an imported family from a file's contents. JSON uses the app's own
 *  export format (validated by `normalizeImport`); anything else is parsed as
 *  GEDCOM and validated with the same invariants. Throws on unrecognised or
 *  malformed input. */
function parseImport(filename: string, text: string): FamilyData {
  const lower = filename.toLowerCase()
  const looksLikeJson =
    lower.endsWith(".json") || text.trimStart().startsWith("{")
  if (looksLikeJson) return normalizeImport(JSON.parse(text))
  return validateImportedFamily(gedcomToFamily(text))
}

function NewTreeDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string, seed?: TreeSeed) => void
}) {
  const [name, setName] = useState("")
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }

  async function handleImport(file: File | undefined) {
    if (!file || importing) return
    setImporting(true)
    try {
      const text = await file.text()
      const people = parseImport(file.name, text)
      onCreate(name.trim() || deriveTreeName(file.name), { people })
    } catch (err) {
      console.error(err)
      toast(
        "Couldn't read that file. Make sure it's a valid .json or .ged export.",
        "error",
      )
      setImporting(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
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
            placeholder="e.g. The Carter Family"
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
              disabled={!name.trim() || importing}
              className={primaryBtn}
            >
              Create tree
            </button>
          </div>
        </form>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import from a file (.json or .ged)
        </button>

        <input
          ref={importRef}
          type="file"
          accept=".json,.ged,.gedcom,application/json"
          className="hidden"
          onChange={(e) => {
            handleImport(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </div>
    </Modal>
  )
}

/**
 * Authenticated home dashboard: tree summary, the user's own trees, trees
 * shared with them, and the create/share dialogs. The page shell
 * (header + search) lives in `HomePage`.
 */
function HomeDashboard({
  index,
  navigate,
  myAccessRequests,
}: {
  index: TreeIndexStore
  navigate: (to: string) => void
  myAccessRequests: RequestedTree[]
}) {
  const { trees, createTree, renameTree, deleteTreeRemote, removeTree } = index
  const [newTreeOpen, setNewTreeOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<TreeMeta | null>(null)

  const own = useMemo(
    () => trees.filter((t) => t.role !== "viewer" && t.role !== "editor"),
    [trees],
  )
  const shared = useMemo(
    () => trees.filter((t) => t.role === "viewer" || t.role === "editor"),
    [trees],
  )
  const accessibleTreeIds = useMemo(
    () => new Set(trees.map((tree) => tree.id)),
    [trees],
  )
  const pendingAccess = useMemo(
    () => myAccessRequests.filter((r) => !accessibleTreeIds.has(r.treeId)),
    [myAccessRequests, accessibleTreeIds],
  )
  const pendingAccessRequestCount = useOwnedAccessRequestCount(own.length > 0)
  const totalPeople = useMemo(
    () => trees.reduce((sum, tree) => sum + countMembers(tree.id), 0),
    [trees],
  )

  function createFromDialog(name: string, seed?: TreeSeed) {
    setNewTreeOpen(false)
    navigate(`/tree/${createTree(name, seed)}`)
  }

  return (
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
        <div className="flex shrink-0 items-center gap-2">
          {own.length > 0 && (
            <button
              type="button"
              onClick={() => navigate("/sharing")}
              aria-label={
                pendingAccessRequestCount > 0
                  ? `Sharing, ${pendingAccessRequestCount} pending access ${pendingAccessRequestCount === 1 ? "request" : "requests"}`
                  : "Sharing"
              }
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-cobalt-700 ring-1 ring-cobalt-200 transition-all hover:bg-cobalt-50 active:scale-95"
            >
              <Users className="h-4 w-4" /> Sharing
              {pendingAccessRequestCount > 0 ? (
                <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {pendingAccessRequestCount > 99
                    ? "99+"
                    : pendingAccessRequestCount}
                </span>
              ) : null}
            </button>
          )}
        </div>
      </div>

      <div className="mt-8">
        {trees.length === 0 && pendingAccess.length === 0 ? (
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
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Your trees
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <NewTreeCard onClick={() => setNewTreeOpen(true)} />
              {pendingAccess.map((request) => (
                <PendingAccessCard
                  key={request.treeId}
                  request={request}
                  navigate={navigate}
                />
              ))}
              {own.map((tree) => (
                <TreeCard
                  key={tree.id}
                  tree={tree}
                  navigate={navigate}
                  onRename={(n) => renameTree(tree.id, n)}
                  onDelete={() => deleteTreeRemote(tree.id)}
                  onRemove={() => removeTree(tree.id)}
                  onShare={() => setShareTarget(tree)}
                />
              ))}
              {shared.map((tree) => (
                <TreeCard
                  key={tree.id}
                  tree={tree}
                  navigate={navigate}
                  onRename={() => {}}
                  onDelete={async () => {}}
                  onRemove={() => {}}
                  onShare={() => {}}
                />
              ))}
            </div>
          </section>
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
          onCreate={createFromDialog}
        />
      )}
    </>
  )
}

export function HomePage({ index }: { index: TreeIndexStore }) {
  const { data: session, isPending } = useSession()
  const hydrated = useHydrated()
  const { requests: myAccessRequests, loading: accessLoading } =
    useMyAccessRequests(!!session?.user)
  const router = useRouter()
  const navigate = (to: string) => router.push(to)
  const treeNameById = useMemo(
    () => new Map(index.trees.map((tree) => [tree.id, tree.name] as const)),
    [index.trees],
  )

  if (isPending) {
    return <div className="min-h-dvh bg-slate-50" />
  }
  if (!session?.user) {
    return <LandingPage />
  }

  let body: ReactNode
  if (!hydrated || accessLoading) {
    body = <HomeSkeleton />
  } else {
    body = (
      <HomeDashboard
        index={index}
        navigate={navigate}
        myAccessRequests={myAccessRequests}
      />
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
            className="h-8 w-8 shrink-0 object-cover"
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
