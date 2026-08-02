import {
  ArrowLeft,
  Check,
  ChevronLeft,
  LoaderCircle,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  TriangleAlert,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { AccountMenu } from "@/components/AccountMenu"
import {
  type FamilyStore,
  type TreeMeta,
  useBlockedChanges,
  usePersonIdentity,
} from "@/store"
import { AddForm } from "./AddForm"
import { ChoosePanel } from "./ChoosePanel"
import { CreateFamilyPanel } from "./CreateFamilyPanel"
import { EditForm } from "./EditForm"
import { EditPersonDetails } from "./EditPersonDetails"
import { LinkChildPanel } from "./LinkChildPanel"
import { LinkParentPanel } from "./LinkParentPanel"
import { LinkSpousePanel } from "./LinkSpousePanel"
import { MarriagePanel } from "./MarriagePanel"
import { ReadonlyDetails } from "./ReadonlyDetails"
import { ReviewChangesPanel } from "./ReviewChangesPanel"
import { SettingsPanel } from "./SettingsPanel"
import { SharePanel } from "./SharePanel"
import { inputCls, primaryBtn, type SidebarState } from "./shared"

export type { SidebarState }

interface Props {
  family: FamilyStore
  treeId: string
  treeName: string
  allTrees: TreeMeta[]
  state: SidebarState
  open: boolean
  editable: boolean
  startingEditMode: boolean
  loading: boolean
  onSelect: (id: string) => void
  onAddRoot: () => void
  onOpenSettings: () => void
  onOpenReviewChanges: () => void
  onClose: () => void
  onToggleEditMode: () => void
  onOpenShare: () => void
  canShare: boolean
  collapsed: boolean
  onCollapse: () => void
}

export function Sidebar({
  family,
  treeId,
  treeName,
  allTrees,
  state,
  open,
  editable,
  startingEditMode,
  loading,
  onSelect,
  onAddRoot,
  onOpenSettings,
  onOpenReviewChanges,
  onClose,
  onToggleEditMode,
  onOpenShare,
  canShare,
  collapsed,
  onCollapse,
}: Props) {
  const count = Object.keys(family.people).length
  const readOnly = family.readOnly
  const blockedChanges = useBlockedChanges(treeId)
  const editingPerson =
    state.mode === "edit" ? family.people[state.personId] : undefined
  // A person selected for editing who isn't a member of this tree (e.g. an
  // ancestor parent shown from another tree). Only their global details are
  // editable here.
  const editingIdentity = usePersonIdentity(
    state.mode === "edit" && !editingPerson ? state.personId : undefined,
  )
  const linkParentPerson =
    state.mode === "linkParent" ? family.people[state.personId] : undefined
  const linkSpousePerson =
    state.mode === "linkSpouse" ? family.people[state.personId] : undefined
  const linkChildPerson =
    state.mode === "linkChild" ? family.people[state.personId] : undefined
  const createFamilyPerson =
    state.mode === "createFamily" ? family.people[state.personId] : undefined
  const choosePerson =
    state.mode === "choose" ? family.people[state.sourceId] : undefined

  return (
    <aside
      className={`flex h-full w-[88vw] max-w-sm shrink-0 flex-col border-r border-slate-200 bg-white/95 backdrop-blur-sm transition-transform duration-200 fixed inset-y-0 left-0 z-40 ${
        collapsed
          ? "md:hidden"
          : "md:relative md:w-96 md:max-w-none md:translate-x-0"
      } ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <button
        type="button"
        aria-label="Collapse panel"
        title="Collapse panel"
        onClick={onCollapse}
        className="absolute top-1/2 right-0 z-50 hidden h-14 w-6 -translate-y-1/2 translate-x-full items-center justify-center rounded-r-lg border-y border-r border-slate-200 bg-white/95 text-slate-400 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600 md:inline-flex"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-1.5">
          <Link
            href="/"
            title="Home"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <span className="text-sm font-medium text-slate-400">Home</span>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold tracking-tight text-slate-800">
            {treeName}
          </h1>
          {loading ? (
            <span
              className="ml-auto inline-block h-6 w-28 shrink-0 tree-skeleton animate-shimmer rounded-full"
              aria-busy="true"
            >
              <span className="sr-only">Loading member count</span>
            </span>
          ) : (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-cobalt-50 px-2.5 py-1 text-xs font-medium text-cobalt-700">
              <Users className="h-3.5 w-3.5" />
              {`${count} members`}
            </span>
          )}
        </div>
      </div>

      <div className="scroll-area flex-1 overflow-y-auto px-5 py-4">
        {!loading
          && !editable
          && state.mode !== "settings"
          && state.mode !== "share" && (
            <div className="mb-4">
              <MemberSearch
                family={family}
                onSelect={onSelect}
              />
            </div>
          )}
        {loading ? (
          <SidebarSkeleton />
        ) : state.mode === "share" ? (
          <SharePanel
            treeId={treeId}
            treeName={treeName}
          />
        ) : state.mode === "reviewChanges" ? (
          <ReviewChangesPanel
            changes={blockedChanges}
            treeId={treeId}
          />
        ) : state.mode === "settings" ? (
          <SettingsPanel
            family={family}
            treeId={treeId}
            treeName={treeName}
            editable={editable}
            onClose={onClose}
          />
        ) : state.mode === "marriage" ? (
          <MarriagePanel
            family={family}
            a={state.a}
            b={state.b}
            editable={editable}
            onClose={onClose}
          />
        ) : state.mode === "add" && editable ? (
          <AddForm
            key={JSON.stringify(state.rel)}
            family={family}
            rel={state.rel}
            onDone={onClose}
            onClose={onClose}
          />
        ) : state.mode === "choose" && choosePerson && editable ? (
          <ChoosePanel
            kind={state.kind}
            sourceId={state.sourceId}
            sourceName={choosePerson.name}
            rel={state.rel}
            createFamily={state.createFamily}
            alsoCreateFamily={state.alsoCreateFamily}
            onClose={onClose}
          />
        ) : state.mode === "linkParent" && linkParentPerson && editable ? (
          <LinkParentPanel
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={linkParentPerson}
            onSelect={onSelect}
            onClose={onClose}
          />
        ) : state.mode === "linkSpouse" && linkSpousePerson && editable ? (
          <LinkSpousePanel
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={linkSpousePerson}
            onClose={onClose}
          />
        ) : state.mode === "linkChild" && linkChildPerson && editable ? (
          <LinkChildPanel
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={linkChildPerson}
            onClose={onClose}
          />
        ) : state.mode === "createFamily" && createFamilyPerson && editable ? (
          <CreateFamilyPanel
            family={family}
            person={createFamilyPerson}
            onClose={onClose}
          />
        ) : editingPerson && editable ? (
          <EditForm
            key={editingPerson.id}
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={editingPerson}
            onSelect={onSelect}
            onClose={onClose}
          />
        ) : editingIdentity && editable ? (
          <EditPersonDetails
            family={family}
            person={editingIdentity}
            onClose={onClose}
          />
        ) : editingPerson ? (
          <ReadonlyDetails
            family={family}
            treeId={treeId}
            person={editingPerson}
            onSelect={onSelect}
          />
        ) : readOnly ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
            You have a <b>viewer</b> role on this tree — read-only. Ask the
            owner for editor access to add or edit people.
          </div>
        ) : editable ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
              <p className="text-sm leading-relaxed text-slate-500">
                Click a card to edit it, or hover a card and tap a{" "}
                <b className="font-semibold text-slate-700">+</b> button to add
                a new parent, spouse or child — or connect a person already in
                the tree.
              </p>
            </div>
            <button
              type="button"
              onClick={onAddRoot}
              className={`${primaryBtn} w-full`}
            >
              <Plus className="h-4 w-4" /> Add unconnected member
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-2">
              <div className="flex w-full gap-2.5 rounded-lg bg-slate-50/70 p-3">
                <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-cobalt-600" />
                <p className="text-sm leading-relaxed text-slate-500">
                  <b className="font-semibold text-slate-700">
                    Select a person
                  </b>
                  <br />
                  Select a person&apos;s card to view their details.
                </p>
              </div>
              <div className="flex w-full gap-2.5 rounded-lg bg-slate-50/70 p-3">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-cobalt-600" />
                <p className="text-sm leading-relaxed text-slate-500">
                  <b className="font-semibold text-slate-700">
                    Find a family member
                  </b>
                  <br />
                  Use the search field above to quickly open someone.
                </p>
              </div>
              <div className="flex w-full gap-2.5 rounded-lg bg-slate-50/70 p-3">
                <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-cobalt-600" />
                <p className="text-sm leading-relaxed text-slate-500">
                  <b className="font-semibold text-slate-700">Edit</b>
                  <br />
                  Choose <b className="font-semibold text-slate-700">Edit</b>{" "}
                  below to add people or update relationships.
                </p>
              </div>
              {canShare && (
                <div className="flex w-full gap-2.5 rounded-lg bg-slate-50/70 p-3">
                  <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-cobalt-600" />
                  <p className="text-sm leading-relaxed text-slate-500">
                    <b className="font-semibold text-slate-700">Share</b>
                    <br />
                    Use <b className="font-semibold text-slate-700">Share</b>{" "}
                    below to invite others and manage access.
                  </p>
                </div>
              )}
              <div className="flex w-full gap-2.5 rounded-lg bg-slate-50/70 p-3">
                <Settings className="mt-0.5 h-4 w-4 shrink-0 text-cobalt-600" />
                <p className="text-sm leading-relaxed text-slate-500">
                  <b className="font-semibold text-slate-700">Settings</b>
                  <br />
                  Use <b className="font-semibold text-slate-700">Settings</b>{" "}
                  below to change the canvas appearance or manage tree data.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={`space-y-2 border-t border-slate-200 px-5 py-4 ${
          loading ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {blockedChanges.length > 0 && (
          <button
            type="button"
            onClick={onOpenReviewChanges}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 shadow-soft ring-1 ring-amber-200 transition-all hover:bg-amber-100 active:scale-95"
          >
            <TriangleAlert className="h-4 w-4" /> Review changes
            <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-xs tabular-nums">
              {blockedChanges.length}
            </span>
          </button>
        )}
        {(state.mode === "settings"
          || state.mode === "reviewChanges"
          || state.mode === "share") && (
          <button
            type="button"
            onClick={onClose}
            className={`${primaryBtn} w-full`}
          >
            Close
          </button>
        )}
        <div className="flex items-stretch">
          {!readOnly && (
            <>
              <button
                aria-label={
                  startingEditMode
                    ? "Refreshing tree before editing"
                    : editable
                      ? "Done editing"
                      : "Edit tree"
                }
                aria-busy={startingEditMode}
                type="button"
                disabled={startingEditMode}
                onClick={onToggleEditMode}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium shadow-soft ring-1 transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-70 ${
                  editable
                    ? "bg-cobalt-600 text-white ring-cobalt-600 hover:bg-cobalt-700"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {startingEditMode ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : editable ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                {startingEditMode ? "Syncing" : editable ? "Done" : "Edit"}
              </button>
              <div
                aria-hidden="true"
                className="my-1 mx-2 w-px self-stretch bg-slate-200"
              />
            </>
          )}
          {canShare && (
            <>
              <button
                type="button"
                onClick={onOpenShare}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${
                  state.mode === "share"
                    ? "bg-cobalt-50 text-cobalt-700"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
              <div
                aria-hidden="true"
                className="my-1 mx-2 w-px self-stretch bg-slate-200"
              />
            </>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${
              state.mode === "settings"
                ? "bg-cobalt-50 text-cobalt-700"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <Settings className="h-4 w-4" /> Settings
          </button>
        </div>
      </div>
    </aside>
  )
}

function MemberSearch({
  family,
  onSelect,
}: {
  family: FamilyStore
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = normalizedQuery
    ? Object.values(family.people)
        .filter((person) =>
          person.name.toLocaleLowerCase().includes(normalizedQuery),
        )
        .sort((first, second) => first.name.localeCompare(second.name))
    : []

  return (
    <div className="relative">
      <label
        htmlFor="tree-member-search"
        className="sr-only"
      >
        Search tree members
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="tree-member-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tree members"
          className={`${inputCls} pl-9`}
        />
      </div>
      {normalizedQuery && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">No matches.</li>
          ) : (
            matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("")
                    onSelect(person.id)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-cobalt-50"
                >
                  {person.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function SidebarSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
        <div className="space-y-2">
          <div className="h-3 w-3/4 tree-skeleton animate-shimmer rounded" />
          <div className="h-3 w-full tree-skeleton animate-shimmer rounded" />
          <div className="h-3 w-2/3 tree-skeleton animate-shimmer rounded" />
        </div>
      </div>
      <div className="h-10 w-full tree-skeleton animate-shimmer rounded-xl" />
    </div>
  )
}
