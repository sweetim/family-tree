import {
  ArrowLeft,
  Check,
  ChevronLeft,
  LoaderCircle,
  Pencil,
  Plus,
  Settings,
  Share2,
  TriangleAlert,
  Users,
} from "lucide-react"
import Link from "next/link"
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
import { primaryBtn, type SidebarState } from "./shared"

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
        className="absolute top-4 right-0 z-50 hidden h-9 w-9 translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-soft transition-colors hover:bg-slate-50 hover:text-slate-700 md:inline-flex"
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
          <div className="ml-auto mr-3">
            <AccountMenu />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold tracking-tight text-slate-800">
            {treeName}
          </h1>
          {loading ? (
            <span
              className="ml-auto inline-block h-6 w-28 shrink-0 animate-pulse rounded-full bg-slate-200"
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
        {loading ? (
          <SidebarSkeleton />
        ) : state.mode === "share" ? (
          <SharePanel
            treeId={treeId}
            treeName={treeName}
            onClose={onClose}
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
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
            <p className="text-sm leading-relaxed text-slate-500">
              Select a card to view its details. Select{" "}
              <b className="font-semibold text-slate-700">Edit</b> to add or
              change people.
            </p>
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
        {(state.mode === "settings" || state.mode === "reviewChanges") && (
          <button
            type="button"
            onClick={onClose}
            className={`${primaryBtn} w-full`}
          >
            Done
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
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 active:scale-95"
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
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 active:scale-95"
          >
            <Settings className="h-4 w-4" /> Settings
          </button>
        </div>
      </div>
    </aside>
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
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
      <div className="h-10 w-full animate-pulse rounded-xl bg-slate-200" />
    </div>
  )
}
