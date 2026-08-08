import {
  ArrowLeft,
  Baby,
  Check,
  ChevronLeft,
  Eye,
  FolderOpen,
  Heart,
  HeartCrack,
  Link2,
  LoaderCircle,
  type LucideIcon,
  MailPlus,
  MousePointerClick,
  Pencil,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { AccountMenu } from "@/components/AccountMenu"
import { useConfirm } from "@/components/Confirm"
import {
  AccessRequestPanel,
  type AccessRequestFormState,
} from "@/components/AccessRequestPanel"
import { useSession } from "@/lib/auth-client"
import { useTreeActions } from "@/lib/tree-actions"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
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
import {
  chooseFromRel,
  inputCls,
  primaryBtn,
  relFromLink,
  type SidebarState,
  sidebarFormIds,
} from "./shared"

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
  stoppingEditMode: boolean
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
  stoppingEditMode,
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
  const { data: session } = useSession()
  const [accessRequestForm, setAccessRequestForm] =
    useState<AccessRequestFormState>({
      active: false,
      canSubmit: false,
      submitting: false,
    })
  const [savedFlash, setSavedFlash] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashSaved = () => {
    setSavedFlash(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSavedFlash(false), 1600)
  }
  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )
  // A "Saved" flash belongs to the person who was just saved. Clear it the
  // moment the edit target changes so the confirmation never bleeds onto a
  // different person's Save button.
  const editTargetId = state.mode === "edit" ? state.personId : undefined
  useEffect(() => {
    setSavedFlash(false)
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = null
    }
  }, [editTargetId])
  const confirm = useConfirm()
  const { getEditingSession } = useTreeEditMode()
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
  const { backToChoose } = useTreeActions()
  const baseFooterAction = getFooterAction({
    state,
    editable,
    editingPerson,
    editingIdentity,
    onAddRoot,
    accessRequestForm,
    isMarriageActive:
      state.mode === "marriage"
      && family.people[state.a]?.unionStatus?.[state.b]?.type !== "divorced",
    onReconcile: () => {
      if (state.mode === "marriage") family.setDivorced(state.a, state.b, false)
    },
  })
  const savedFlashActive =
    savedFlash && state.mode === "edit" && editable && !!baseFooterAction
  const footerAction = savedFlashActive
    ? {
        ...baseFooterAction,
        label: "Saved",
        icon: Check,
        className: `${baseFooterAction.className ?? ""} bg-emerald-600! hover:bg-emerald-700!`,
      }
    : baseFooterAction
  const FooterActionIcon = footerAction?.icon
  const selectionAction = getSelectionAction(state)
  const hasSidebarAction =
    blockedChanges.length > 0
    || !!footerAction
    || !!selectionAction
    || state.mode !== "idle"

  async function removeFromTree() {
    if (!editingPerson) return
    const editingSession = getEditingSession(treeId)
    if (editingSession === null) return
    const confirmed = await confirm({
      title: "Remove from tree",
      message: `Remove ${editingPerson.name} from this tree?`,
      confirmText: "Remove",
      tone: "danger",
    })
    if (confirmed && getEditingSession(treeId) === editingSession) {
      family.removeFromTree(editingPerson.id, treeId)
      onClose()
    }
  }

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
           && state.mode !== "share"
           && state.mode !== "requestAccess" && (
            <div className="mb-4">
              <MemberSearch
                family={family}
                onSelect={onSelect}
              />
            </div>
          )}
        {loading ? (
          <SidebarSkeleton />
        ) : state.mode === "requestAccess" ? (
          <AccessRequestPanel
            treeId={state.treeId}
            treeName={state.treeName}
            email={session?.user.email ?? ""}
            onRequestUpdated={state.onRequestUpdated}
            sidebar
            formId={sidebarFormIds.accessRequest}
            onFormStateChange={setAccessRequestForm}
          />
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
          />
        ) : state.mode === "add" && editable ? (
          <AddForm
            key={JSON.stringify(state.rel)}
            family={family}
            rel={state.rel}
            defaultFamilyName={treeName}
            onDone={onClose}
          />
        ) : state.mode === "choose" && choosePerson && editable ? (
          <ChoosePanel
            kind={state.kind}
            sourceId={state.sourceId}
            sourceName={choosePerson.name}
            rel={state.rel}
            createFamily={state.createFamily}
            alsoCreateFamily={state.alsoCreateFamily}
          />
        ) : state.mode === "linkParent" && linkParentPerson && editable ? (
          <LinkParentPanel
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={linkParentPerson}
            onSelect={onSelect}
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
            onSaved={flashSaved}
          />
        ) : editingIdentity && editable ? (
          <EditPersonDetails
            family={family}
            person={editingIdentity}
            onSaved={flashSaved}
          />
        ) : editingPerson ? (
          <ReadonlyDetails
            family={family}
            treeId={treeId}
            person={editingPerson}
            onSelect={onSelect}
          />
        ) : readOnly ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-2">
              <div className="flex w-full gap-2.5 rounded-lg bg-amber-50 p-3">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-sm leading-relaxed text-amber-800">
                  <b className="font-semibold">Read-only</b>
                  <br />
                  You have a <b>viewer</b> role on this tree. Ask the owner for
                  editor access to add or edit people.
                </p>
              </div>
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
        ) : editable ? (
          <div className="animate-slide-up space-y-5">
            <div className="overflow-hidden rounded-2xl border border-cobalt-100 bg-linear-to-br from-cobalt-50 via-white to-sky-50/70 shadow-soft">
              <div className="border-b border-cobalt-100/80 px-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cobalt-600 text-white shadow-sm">
                    <MousePointerClick className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                      Build this tree
                    </h2>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
                      Select any person to edit their details or grow their
                      family.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 p-3">
                <div className="rounded-xl border border-white bg-white/85 p-2.5 text-center shadow-sm">
                  <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                    <Users className="h-4 w-4" />
                  </span>
                  <p className="mt-1.5 text-xs font-semibold text-slate-700">
                    Parent
                  </p>
                </div>
                <div className="rounded-xl border border-white bg-white/85 p-2.5 text-center shadow-sm">
                  <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <Heart className="h-4 w-4" />
                  </span>
                  <p className="mt-1.5 text-xs font-semibold text-slate-700">
                    Spouse
                  </p>
                </div>
                <div className="rounded-xl border border-white bg-white/85 p-2.5 text-center shadow-sm">
                  <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                    <Baby className="h-4 w-4" />
                  </span>
                  <p className="mt-1.5 text-xs font-semibold text-slate-700">
                    Child
                  </p>
                </div>
              </div>

              <div className="mx-3 mb-3 flex items-start gap-2 rounded-xl bg-white/75 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cobalt-600" />
                <p>
                  Use a card&apos;s{" "}
                  <b className="font-semibold text-slate-700">+</b> controls to
                  add someone new or connect a person already in a family.
                </p>
              </div>
            </div>
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
        className={`space-y-2 px-5 py-4 ${
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
        {footerAction && (
          <button
            type={footerAction.formId ? "submit" : "button"}
            form={footerAction.formId}
            onClick={(event) => {
              // Cancel the default for onClick-driven actions: a store update
              // here can synchronously re-render this button into a submit
              // button (e.g. Reconcile -> Mark as divorced), which would
              // otherwise submit the form in the same click and undo the action.
              if (footerAction.onClick) {
                event.preventDefault()
                footerAction.onClick()
              }
            }}
            disabled={footerAction.disabled}
            aria-busy={footerAction.spinning || undefined}
            className={`${primaryBtn} w-full ${footerAction.className ?? ""}`}
          >
            {FooterActionIcon && (
              <FooterActionIcon
                className={`h-4 w-4 ${footerAction.spinning ? "animate-spin" : ""}`}
              />
            )}
            {footerAction.label}
          </button>
        )}
        {state.mode === "edit" && editable && editingPerson && (
          <button
            type="button"
            onClick={() => void removeFromTree()}
            className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50 active:scale-95"
          >
            <Trash2 className="h-4 w-4" /> Remove from tree
          </button>
        )}
        {selectionAction && (
          <button
            type="button"
            onClick={() =>
              backToChoose(
                selectionAction.kind,
                selectionAction.sourceId,
                selectionAction.rel,
                selectionAction.options,
              )
            }
            className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-cobalt-50 px-3 py-2 text-sm font-medium text-cobalt-700 ring-1 ring-cobalt-200 transition-colors hover:bg-cobalt-100 active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        )}
        {state.mode !== "idle" && !selectionAction && !loading && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:scale-95"
          >
            <X className="h-4 w-4" /> Close
          </button>
        )}
        <div
          className={`flex items-stretch ${
            hasSidebarAction
              ? "border-t-2 border-slate-300 pt-2"
              : "border-t border-slate-200 pt-2"
          }`}
        >
          {!readOnly && (
            <>
              <button
                aria-label={
                  startingEditMode
                    ? "Refreshing tree before editing"
                    : editable
                      ? stoppingEditMode
                        ? "Saving changes before leaving"
                        : "Done editing"
                      : "Edit tree"
                }
                aria-busy={startingEditMode || stoppingEditMode}
                type="button"
                disabled={startingEditMode || stoppingEditMode}
                onClick={onToggleEditMode}
                className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium shadow-soft ring-1 transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-70 ${
                  editable
                    ? "bg-cobalt-600 text-white ring-cobalt-600 hover:bg-cobalt-700"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {startingEditMode || stoppingEditMode ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : editable ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                {startingEditMode
                  ? "Syncing"
                  : stoppingEditMode
                    ? "Saving…"
                    : editable
                      ? "Done"
                      : "Edit"}
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
                className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${
                  state.mode === "share"
                    ? "bg-cobalt-50 text-cobalt-700 ring-1 ring-cobalt-200"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
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
            className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${
              state.mode === "settings"
                ? "bg-cobalt-50 text-cobalt-700 ring-1 ring-cobalt-200"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            <Settings className="h-4 w-4" /> Settings
          </button>
        </div>
      </div>
    </aside>
  )
}

type FooterAction = {
  label: string
  icon: LucideIcon
  formId?: string
  onClick?: () => void
  className?: string
  disabled?: boolean
  spinning?: boolean
}

function getFooterAction({
  state,
  editable,
  editingPerson,
  editingIdentity,
  onAddRoot,
  isMarriageActive,
  onReconcile,
  accessRequestForm,
}: {
  state: SidebarState
  editable: boolean
  editingPerson: unknown
  editingIdentity: unknown
  onAddRoot: () => void
  isMarriageActive: boolean
  onReconcile: () => void
  accessRequestForm: AccessRequestFormState
}): FooterAction | undefined {
  if (state.mode === "idle" && editable)
    return { label: "Add person", icon: UserPlus, onClick: onAddRoot }
  if (state.mode === "add" && editable)
    return {
      label: "Save",
      icon: Save,
      formId: sidebarFormIds.addPerson,
    }
  if (state.mode === "edit" && editable && (editingPerson || editingIdentity))
    return {
      label: "Save",
      icon: Save,
      formId: sidebarFormIds.editPerson,
    }
  if (state.mode === "createFamily" && editable)
    return {
      label: "Save & open",
      icon: FolderOpen,
      formId: sidebarFormIds.createFamily,
    }
  if (state.mode === "share")
    return {
      label: "Add invite",
      icon: MailPlus,
      formId: sidebarFormIds.shareInvite,
    }
  if (state.mode === "requestAccess" && accessRequestForm.active)
    return {
      label: "Send request",
      icon: accessRequestForm.submitting ? LoaderCircle : Send,
      formId: sidebarFormIds.accessRequest,
      disabled: !accessRequestForm.canSubmit,
      spinning: accessRequestForm.submitting,
    }
  if (state.mode === "marriage" && editable && isMarriageActive)
    return {
      label: "Mark as divorced",
      icon: HeartCrack,
      formId: sidebarFormIds.marriage,
      className: "bg-rose-600 hover:bg-rose-700",
    }
  if (state.mode === "marriage" && editable && !isMarriageActive)
    return {
      label: "Reconcile",
      icon: Heart,
      onClick: onReconcile,
    }
}

function getSelectionAction(state: SidebarState): SelectionAction | undefined {
  if (state.mode === "add") {
    const target = chooseFromRel(state.rel)
    return target ? { ...target, rel: state.rel } : undefined
  }
  if (state.mode === "linkParent")
    return {
      kind: "parent" as const,
      sourceId: state.personId,
      rel: relFromLink("parent", state.personId),
    }
  if (state.mode === "linkSpouse")
    return {
      kind: "spouse" as const,
      sourceId: state.personId,
      rel: relFromLink("spouse", state.personId),
    }
  if (state.mode === "linkChild")
    return {
      kind: "child" as const,
      sourceId: state.personId,
      rel: relFromLink("child", state.personId),
    }
  if (state.mode === "createFamily")
    return {
      kind: state.kind,
      sourceId: state.personId,
      rel: state.rel,
      options: {
        createFamily: state.createFamily,
        alsoCreateFamily: state.alsoCreateFamily,
      },
    }
}

type SelectionAction = {
  kind: import("@/lib/tree-actions").LinkKind
  sourceId: string
  rel: import("@/types").Relationship
  options?: { createFamily?: boolean; alsoCreateFamily?: boolean }
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
