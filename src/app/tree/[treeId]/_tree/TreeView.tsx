import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import { ChevronRight, Menu } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useConfirm } from "@/components/Confirm"
import { PersonNode } from "@/components/PersonNode"
import { useToast } from "@/components/Toast"
import { UnionNode } from "@/components/UnionNode"
import { useSession } from "@/lib/auth-client"
import {
  buildFlow,
  computeTreeLayout,
  type FlowEdge,
  type FlowNode,
} from "@/lib/layout"
import { type TreeActions, TreeActionsContext } from "@/lib/tree-actions"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
import { useViewSettings } from "@/lib/view-settings"
import {
  applyTreeManifest,
  fetchTreeManifest,
  getSyncStatus,
  hasBlockedChanges,
  synchronizePending,
  synchronizeTreeFresh,
  type TreeMeta,
  useFamily,
  useFamilyAll,
  useTreeFreshlyLoaded,
} from "@/store"
import { filterBloodlinePeople } from "@/types"
import { Sidebar, type SidebarState } from "../_sidebar/Sidebar"
import { ConnectBanner } from "./ConnectBanner"
import { useConnectionTarget } from "./useConnectionTarget"
import { usePdfExport } from "./usePdfExport"

const nodeTypes = { person: PersonNode, union: UnionNode }

export function TreeView({
  tree,
  allTrees,
  openPersonId,
}: {
  tree: TreeMeta
  allTrees: TreeMeta[]
  /** Person to open on arrival, from a #/tree/{id}/p/{personId} link. */
  openPersonId?: string
}) {
  // The real sidebar chrome renders immediately; only its still-loading bits
  // (member count, body) and the canvas shimmer until the tree's authoritative
  // server snapshot has been applied this session — see `freshlyLoaded` in
  // TreeCanvas. That keeps the first real canvas frame on the fresh snapshot
  // (no reshape, no ancestor-badge relabel) while the sidebar is usable now.
  return (
    <ReactFlowProvider>
      <TreeCanvas
        tree={tree}
        allTrees={allTrees}
        openPersonId={openPersonId}
      />
    </ReactFlowProvider>
  )
}

function SkeletonCard() {
  return (
    <div className="flex aspect-[176/186] w-full flex-col items-center gap-[6.8%] rounded-2xl border border-slate-200 bg-white px-[9.1%] py-[9.1%] shadow-soft">
      <div className="tree-skeleton animate-shimmer aspect-square w-[59.1%] rounded-full" />
      <div className="tree-skeleton animate-shimmer h-[7.5%] w-[63.6%] rounded" />
      <div className="tree-skeleton animate-shimmer h-[6.5%] w-[45.5%] rounded-full" />
    </div>
  )
}

function TreeSkeleton() {
  // A small family tree, not three loose cards: a couple joined by a marriage
  // line with a union dot at the real COUPLE_LINE_Y, a long parent->child bus,
  // and three children (the middle one under the dot). Card width (176px) and
  // the gaps match the live layout, so the placeholder reads as a tree. Lines
  // are one continuous SVG so the dot-to-bus connector stays unbroken; cards
  // are placed over it.
  return (
    <div className="relative aspect-[624/500] w-full max-w-[624px] overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 624 500"
        fill="none"
        aria-hidden="true"
      >
        <line
          x1="288"
          y1="64"
          x2="336"
          y2="64"
          strokeWidth="1"
          className="stroke-slate-200"
        />
        <circle
          cx="312"
          cy="64"
          r="6"
          className="fill-slate-200"
        />
        <path
          d="M312 70 V300 M88 270 H536 M88 270 V300 M536 270 V300"
          strokeWidth="1"
          className="stroke-slate-200"
        />
      </svg>
      <div className="absolute left-[17.95%] top-0 w-[28.21%]">
        <SkeletonCard />
      </div>
      <div className="absolute left-[53.85%] top-0 w-[28.21%]">
        <SkeletonCard />
      </div>
      <div className="absolute left-0 top-[60%] w-[28.21%]">
        <SkeletonCard />
      </div>
      <div className="absolute left-[35.9%] top-[60%] w-[28.21%]">
        <SkeletonCard />
      </div>
      <div className="absolute left-[71.79%] top-[60%] w-[28.21%]">
        <SkeletonCard />
      </div>
    </div>
  )
}

function CanvasSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden p-6">
      <TreeSkeleton />
    </div>
  )
}

function TreeCanvas({
  tree,
  allTrees,
  openPersonId,
}: {
  tree: TreeMeta
  allTrees: TreeMeta[]
  /** Person to open on arrival, from a #/tree/{id}/p/{personId} link. */
  openPersonId?: string
}) {
  const family = useFamily(tree.id)
  // The sidebar's still-loading bits (member count, body) and the canvas
  // shimmer until the fresh server snapshot is applied this session. Unlike
  // `tree.loaded` (which is persisted and so can already be true on reload),
  // this is only set once `applyTreeSnapshot` runs, so it is not fooled by
  // stale persisted data.
  const freshlyLoaded = useTreeFreshlyLoaded(tree.id)
  const sidebarLoading = !freshlyLoaded
  const { data: session } = useSession()
  const { editingTreeId, getEditingSession, isTreeEditing, setEditingTreeId } =
    useTreeEditMode()
  const confirm = useConfirm()
  const toast = useToast()
  const { settings } = useViewSettings()
  // People used for rendering. "Show all families" merges every family that
  // shares at least one member with this one onto the canvas; otherwise this
  // reuses `useFamily`'s projection (avoiding a second projectTree pass).
  const allFamilies = useFamilyAll(tree.id, settings.showAllFamilies)
  const renderPeople = useMemo(() => {
    const people = settings.showAllFamilies ? allFamilies : family.people
    return settings.highlightBloodline
      && (settings.hideNonDescendants || settings.hideAmberBloodline)
      ? filterBloodlinePeople(people, {
          hideNonDescendants: settings.hideNonDescendants,
          hideAmberBloodline: settings.hideAmberBloodline,
        })
      : people
  }, [
    allFamilies,
    family.people,
    settings.hideAmberBloodline,
    settings.hideNonDescendants,
    settings.highlightBloodline,
    settings.showAllFamilies,
  ])
  const [sidebar, setSidebar] = useState<SidebarState>(() =>
    openPersonId ? { mode: "edit", personId: openPersonId } : { mode: "idle" },
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const {
    link,
    setLink,
    targetKind,
    targetSourceId,
    targetSource,
    linkEligible,
  } = useConnectionTarget(sidebar, family.people, setSidebar, setDrawerOpen)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [startingEditMode, setStartingEditMode] = useState(false)
  const editModeRequest = useRef(0)
  const editModeAbort = useRef<AbortController | null>(null)
  const editMode = editingTreeId === tree.id
  const { fitView, getNode, getViewport, setCenter } = useReactFlow()
  // Crossfade the canvas skeleton into the real tree. The tree mounts as soon
  // as the fresh snapshot is ready (opacity 0, so it can measure/fitView
  // first), then `revealed` flips on the next frame to drive both opacities.
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (!freshlyLoaded) {
      setRevealed(false)
      return
    }
    const frame = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(frame)
  }, [freshlyLoaded])

  // When "show all families" is toggled off, the canvas collapses to just this
  // family. Refit so the smaller layout centers instead of leaving the viewport
  // pinned where the larger merged graph was. One frame lets the reflowed nodes
  // measure before fitView computes bounds.
  const prevShowAllFamilies = useRef(settings.showAllFamilies)
  useEffect(() => {
    const wasAll = prevShowAllFamilies.current
    prevShowAllFamilies.current = settings.showAllFamilies
    if (wasAll && !settings.showAllFamilies) {
      const frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.2, maxZoom: 1, duration: 0 })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [settings.showAllFamilies, fitView])

  // Follow cross-tree jumps that land on this already-mounted tree.
  useEffect(() => {
    if (openPersonId) {
      setSidebar({ mode: "edit", personId: openPersonId })
      setDrawerOpen(true)
      setSidebarHidden(false)
    }
  }, [openPersonId])

  // Edit mode is scoped to the mounted tree so navigating away always returns
  // to read mode, including when the user later revisits the same tree.
  useEffect(() => {
    return () => {
      editModeRequest.current += 1
      editModeAbort.current?.abort()
      if (isTreeEditing(tree.id)) setEditingTreeId(null)
    }
  }, [isTreeEditing, setEditingTreeId, tree.id])

  const canEdit = !family.readOnly && editMode

  // Cancel mutation workflows as soon as edit access or edit mode ends.
  useEffect(() => {
    if (canEdit) return
    setLink(undefined)
    setSidebar((current) => {
      switch (current.mode) {
        case "add":
        case "choose":
        case "linkParent":
        case "linkSpouse":
        case "linkChild":
        case "createFamily":
          return { mode: "idle" }
        default:
          return current
      }
    })
    if (family.readOnly && editingTreeId === tree.id) {
      setEditingTreeId(null)
    }
  }, [canEdit, editingTreeId, family.readOnly, setEditingTreeId, tree.id])

  const toggleEditMode = async () => {
    if (editMode) {
      editModeRequest.current += 1
      editModeAbort.current?.abort()
      setEditingTreeId(null)
      return
    }
    if (family.readOnly || startingEditMode) return

    const request = ++editModeRequest.current
    const abortController = new AbortController()
    editModeAbort.current?.abort()
    editModeAbort.current = abortController
    setStartingEditMode(true)
    try {
      const stopForConflict = () => {
        if (getSyncStatus() !== "conflict") return false
        if (hasBlockedChanges(tree.id)) {
          setSidebar({ mode: "reviewChanges" })
          setDrawerOpen(true)
          setSidebarHidden(false)
          toast("Review conflicting changes before editing.", "error")
        } else {
          toast("Resolve sync conflicts in the affected tree first.", "error")
        }
        return true
      }
      await synchronizePending()
      if (request !== editModeRequest.current || stopForConflict()) return
      const manifest = await fetchTreeManifest()
      if (request !== editModeRequest.current) return
      applyTreeManifest(manifest)
      const currentTree = manifest.find((item) => item.id === tree.id)
      if (!currentTree || currentTree.role === "viewer") {
        toast("You do not have permission to edit this tree.", "error")
        return
      }
      await synchronizeTreeFresh(tree.id, abortController.signal)
      if (request !== editModeRequest.current || stopForConflict()) return
      setEditingTreeId(tree.id)
    } catch (error) {
      if (request !== editModeRequest.current) return
      console.error("edit mode sync failed", error)
      toast("Could not refresh the tree before editing.", "error")
    } finally {
      if (request === editModeRequest.current) setStartingEditMode(false)
      if (editModeAbort.current === abortController)
        editModeAbort.current = null
    }
  }

  const selectedId = sidebar.mode === "edit" ? sidebar.personId : undefined
  // Layout (positions + couples) depends only on the rendered people, so it is
  // memoized separately from selection. Selecting a card or toggling
  // click-to-connect re-runs the cheap node/edge decoration below, never the
  // expensive rank fixpoint / recursive positioner.
  const layout = useMemo(() => computeTreeLayout(renderPeople), [renderPeople])
  const { nodes, edges } = useMemo(() => {
    const linking =
      targetSourceId && linkEligible
        ? { sourceId: targetSourceId, eligible: linkEligible }
        : undefined
    return buildFlow(
      renderPeople,
      layout,
      selectedId,
      linking,
      settings.highlightBloodline,
    )
  }, [
    renderPeople,
    layout,
    selectedId,
    targetSourceId,
    linkEligible,
    settings.highlightBloodline,
  ])

  useEffect(() => {
    if (
      !freshlyLoaded
      || canEdit
      || !selectedId
      || !settings.focusSelectedPerson
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      const node = getNode(selectedId)
      if (!node) return
      const width = node.measured?.width ?? 176
      const height = node.measured?.height ?? 220
      void setCenter(
        node.position.x + width / 2,
        node.position.y + height / 2,
        {
          zoom: getViewport().zoom,
          duration: 250,
        },
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [
    canEdit,
    freshlyLoaded,
    getNode,
    getViewport,
    selectedId,
    setCenter,
    settings.focusSelectedPerson,
  ])

  const { printing, exportPdf } = usePdfExport()

  const actions = useMemo<TreeActions>(
    () => ({
      openAdd: (rel) => {
        if (!canEdit) return
        setSidebar({ mode: "add", rel })
        setDrawerOpen(true)
      },
      openChoose: (kind, sourceId, rel, options) => {
        if (!canEdit) return
        setSidebar({
          mode: "choose",
          kind,
          sourceId,
          rel,
          createFamily: options?.createFamily,
          alsoCreateFamily: options?.alsoCreateFamily,
        })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      openCreateFamily: (personId, kind, rel, options) => {
        if (!canEdit) return
        setSidebar({
          mode: "createFamily",
          personId,
          kind,
          rel,
          createFamily: options?.createFamily,
          alsoCreateFamily: options?.alsoCreateFamily,
        })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      backToChoose: (kind, sourceId, rel, options) => {
        if (!canEdit) return
        setLink(undefined)
        setSidebar({
          mode: "choose",
          kind,
          sourceId,
          rel,
          createFamily: options?.createFamily,
          alsoCreateFamily: options?.alsoCreateFamily,
        })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      startLink: (kind, sourceId) => {
        if (!canEdit) return
        setLink({ kind, sourceId })
        // For parents, also surface a focused sidebar panel so the cross-tree
        // picker is reachable — the canvas can only target cards already in
        // this tree.
        if (kind === "parent") {
          setSidebar({ mode: "linkParent", personId: sourceId })
          setDrawerOpen(true)
          setSidebarHidden(false)
        } else if (kind === "spouse") {
          setSidebar({ mode: "linkSpouse", personId: sourceId })
          setDrawerOpen(true)
          setSidebarHidden(false)
        } else if (kind === "child") {
          setSidebar({ mode: "linkChild", personId: sourceId })
          setDrawerOpen(true)
          setSidebarHidden(false)
        }
      },
      editMarriage: (a, b) => {
        // Ignore while click-to-connect is active (a dot isn't a valid target).
        if (!canEdit || link) return
        setSidebar({ mode: "marriage", a, b })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      openRequestAccess: (treeId, treeName, onRequestUpdated) => {
        setSidebar({ mode: "requestAccess", treeId, treeName, onRequestUpdated })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      readOnly: !canEdit,
      exportPdf,
    }),
    [canEdit, link, exportPdf],
  )

  // Linking a married person as a parent brings their spouse into the other
  // parent slot, so the child hangs from the couple. addParent's own guards
  // skip spouses that are duplicates, over the two-parent cap, or would cycle.
  const linkCoupleAsParents = (childId: string, parentId: string) => {
    family.addParent(childId, parentId)
    for (const sid of family.people[parentId]?.spouseIds ?? []) {
      family.addParent(childId, sid)
    }
  }

  const onNodeClick: NodeMouseHandler<FlowNode> = (_e, node) => {
    if (sidebar.mode === "settings") return
    // Union dots are handled by their own onClick (see UnionNode) which routes
    // through TreeActions.editMarriage, so they never reach the person logic.
    if (node.type !== "person") return
    if (canEdit && targetKind && targetSourceId) {
      // Click-to-connect is active — either an explicit session (link) or the
      // chooser panel is open. Clicking an eligible card completes the link;
      // the source card and ineligible cards do nothing.
      if (node.id === targetSourceId) {
        if (link) setLink(undefined)
        return
      }
      if (!linkEligible?.has(node.id)) return
      if (targetKind === "spouse") family.linkSpouse(targetSourceId, node.id)
      else if (targetKind === "parent")
        linkCoupleAsParents(targetSourceId, node.id)
      else linkCoupleAsParents(node.id, targetSourceId)
      if (link) setLink(undefined)
      else setSidebar({ mode: "edit", personId: targetSourceId })
      return
    }
    setSidebar({ mode: "edit", personId: node.id })
    setDrawerOpen(true)
    setSidebarHidden(false)
  }

  const onEdgeClick: EdgeMouseHandler<FlowEdge> = async (_e, edge) => {
    const editingSession = getEditingSession(tree.id)
    if (!canEdit || editingSession === null || link) return
    const data = edge.data
    if (!data) return

    if (data.kind === "couple" && data.a && data.b) {
      const a = family.people[data.a]
      const b = family.people[data.b]
      if (!a || !b) return
      if (!a.spouseIds.includes(b.id)) return // co-parent line only, no marriage to remove
      const confirmed = await confirm({
        title: "Remove marriage",
        message: `Remove the marriage between ${a.name} and ${b.name}?`,
        confirmText: "Remove",
        tone: "danger",
      })
      if (confirmed && getEditingSession(tree.id) === editingSession) {
        family.unlinkSpouse(a.id, b.id)
      }
    } else if (data.kind === "child" && data.childId && data.parentIds) {
      const child = family.people[data.childId]
      if (!child) return
      const names = data.parentIds
        .map((id) => family.people[id]?.name)
        .filter(Boolean)
        .join(" and ")
      const confirmed = await confirm({
        title: "Detach child",
        message: `Detach ${child.name} from ${names}?`,
        confirmText: "Detach",
        tone: "danger",
      })
      if (confirmed && getEditingSession(tree.id) === editingSession) {
        for (const pid of data.parentIds) family.removeParent(child.id, pid)
      }
    }
  }

  const onBeforeDelete = async ({
    nodes: toDelete,
  }: {
    nodes: FlowNode[]
    edges: Edge[]
  }) => {
    if (!canEdit) return false
    const editingSession = getEditingSession(tree.id)
    if (editingSession === null) return false
    const persons = toDelete.filter((n) => n.type === "person")
    if (persons.length === 0) return false
    if (
      persons.some(
        (node) =>
          node.data.person.ownerId
          && node.data.person.ownerId !== session?.user.id,
      )
    ) {
      toast("Only the person owner can delete them from every tree.", "error")
      return false
    }
    const names = persons.map((n) => n.data.person.name).join(", ")
    const confirmed = await confirm({
      title: "Delete people",
      message: `Delete ${names} from ALL trees?`,
      confirmText: "Delete",
      tone: "danger",
    })
    return confirmed && getEditingSession(tree.id) === editingSession
  }

  const onNodesDelete = (deleted: FlowNode[]) => {
    if (!canEdit || !isTreeEditing(tree.id)) return
    for (const node of deleted) {
      if (node.type === "person") family.deletePerson(node.id)
    }
    setSidebar({ mode: "idle" })
    setDrawerOpen(false)
  }

  return (
    <TreeActionsContext.Provider value={actions}>
      <div className="flex h-dvh w-full app-bg">
        <Sidebar
          family={family}
          treeId={tree.id}
          treeName={tree.name}
          allTrees={allTrees}
          state={sidebar}
          open={drawerOpen}
          editable={canEdit}
          startingEditMode={startingEditMode}
          loading={sidebarLoading}
          collapsed={sidebarHidden}
          onToggleEditMode={() => void toggleEditMode()}
          onCollapse={() => setSidebarHidden(true)}
          onSelect={(id) => {
            setSidebar({ mode: "edit", personId: id })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          onAddRoot={() => {
            setSidebar({ mode: "add", rel: { kind: "root" } })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          onOpenSettings={() => {
            setSidebar({ mode: "settings" })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          onOpenReviewChanges={() => {
            setSidebar({ mode: "reviewChanges" })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          onOpenShare={() => {
            setSidebar({ mode: "share" })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          canShare={tree.role === "owner"}
          onClose={() => {
            setLink(undefined)
            setSidebar({ mode: "idle" })
            setDrawerOpen(false)
          }}
        />

        {drawerOpen && (
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm print:hidden md:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <div className="relative min-w-0 flex-1">
          {sidebarHidden && (
            <button
              type="button"
              aria-label="Show panel"
              title="Show panel"
              onClick={() => setSidebarHidden(false)}
              className="absolute top-1/2 left-0 z-20 hidden h-14 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border-y border-r border-slate-200 bg-white/95 text-slate-400 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600 print:hidden md:inline-flex"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <div className="absolute left-3 top-3 z-20 print:hidden md:hidden">
            <button
              aria-label="Open panel"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-soft ring-1 ring-slate-200 transition-colors hover:bg-slate-50 active:scale-95"
              type="button"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
          {freshlyLoaded && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => {
                if (sidebar.mode === "settings") return
                setSidebar({ mode: "idle" })
                setDrawerOpen(false)
                if (!canEdit) return
                setLink(undefined)
              }}
              deleteKeyCode={canEdit ? ["Delete", "Backspace"] : []}
              onBeforeDelete={onBeforeDelete}
              onNodesDelete={onNodesDelete}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.1}
              onlyRenderVisibleElements={!printing}
              nodesConnectable={false}
              nodesDraggable={false}
              proOptions={{ hideAttribution: true }}
              className={`transition-opacity duration-300 ease-out ${
                revealed ? "opacity-100" : "opacity-0"
              }`}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                color="#cbd5e1"
              />
              <Controls showInteractive={false} />
              {settings.minimap && (
                <MiniMap
                  pannable
                  zoomable
                  className="!bg-slate-100 hidden md:block"
                />
              )}

              {targetKind && targetSource && (
                <ConnectBanner
                  targetKind={targetKind}
                  targetSource={targetSource}
                  linkEligible={linkEligible}
                  onCancel={() => {
                    if (link) setLink(undefined)
                    else {
                      setSidebar({ mode: "idle" })
                      setDrawerOpen(false)
                    }
                  }}
                />
              )}
            </ReactFlow>
          )}
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out ${
              revealed ? "opacity-0" : "opacity-100"
            }`}
          >
            <CanvasSkeleton />
          </div>
        </div>
      </div>
    </TreeActionsContext.Provider>
  )
}
