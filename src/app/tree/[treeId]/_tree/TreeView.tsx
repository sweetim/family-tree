import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  getNodesBounds,
  getViewportForBounds,
  MiniMap,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import { Link2, Menu, PanelLeftOpen, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import {
  type LinkKind,
  type TreeActions,
  TreeActionsContext,
} from "@/lib/tree-actions"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
import { useViewSettings } from "@/lib/view-settings"
import {
  applyTreeManifest,
  fetchTreeManifest,
  getSyncStatus,
  synchronizePending,
  synchronizeTreeFresh,
  type TreeMeta,
  useFamily,
  useFamilyAll,
} from "@/store"
import { ancestorsOf, descendantsOf } from "@/types"
import { Sidebar, type SidebarState } from "../_sidebar/Sidebar"

const nodeTypes = { person: PersonNode, union: UnionNode }

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

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
  const loadedMemberCount = Object.keys(family.people).length
  const sidebarLoading =
    !tree.loaded && (tree.memberCount ?? 0) > 0 && loadedMemberCount === 0
  const { data: session } = useSession()
  const { editingTreeId, getEditingSession, isTreeEditing, setEditingTreeId } =
    useTreeEditMode()
  const confirm = useConfirm()
  const toast = useToast()
  const { settings } = useViewSettings()
  // People used for rendering. "Show all families" merges every family that
  // shares at least one member with this one onto the canvas; otherwise this
  // equals family.people.
  const renderPeople = useFamilyAll(tree.id, settings.showAllFamilies)
  const [sidebar, setSidebar] = useState<SidebarState>(() =>
    openPersonId ? { mode: "edit", personId: openPersonId } : { mode: "idle" },
  )
  const [link, setLink] = useState<{ kind: LinkKind; sourceId: string }>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [startingEditMode, setStartingEditMode] = useState(false)
  const editModeRequest = useRef(0)
  const editModeAbort = useRef<AbortController | null>(null)
  const editMode = editingTreeId === tree.id
  const { fitView, getNodes, getViewport, setViewport } = useReactFlow()
  const [printing, setPrinting] = useState(false)

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
        setSidebar({ mode: "reviewChanges" })
        setDrawerOpen(true)
        setSidebarHidden(false)
        toast("Review conflicting changes before editing.", "error")
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

  // Both an explicit click-to-connect session (link) and the chooser panel
  // (sidebar "Add/Connect") target a source person + relation kind. Collapsing
  // them into a single target lets the canvas highlight connectable cards — and
  // complete a connection on click — the moment the chooser opens, not only
  // after pressing "Connect existing".
  const chooserKind = sidebar.mode === "choose" ? sidebar.kind : undefined
  const chooserSourceId =
    sidebar.mode === "choose" ? sidebar.sourceId : undefined
  const targetKind = link?.kind ?? chooserKind
  const targetSourceId = link?.sourceId ?? chooserSourceId
  const targetSource = targetSourceId
    ? family.people[targetSourceId]
    : undefined

  // Cancel the active task if its source disappears (e.g. deleted from the sidebar).
  useEffect(() => {
    if (link && !targetSource) setLink(undefined)
  }, [link, targetSource])

  useEffect(() => {
    if (!targetKind) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (link) setLink(undefined)
      else {
        setSidebar({ mode: "idle" })
        setDrawerOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [targetKind, link])

  // Who may be clicked to complete the pending connection. Mirrors the
  // sidebar's dropdown rules: max two parents, no duplicate links, and no
  // cycles (an ancestor can't become a child, a descendant can't become a parent).
  const linkEligible = useMemo(() => {
    if (!targetKind || !targetSourceId || !targetSource) return undefined
    const eligible = new Set<string>()
    if (targetKind === "parent" && targetSource.parents.length >= 2)
      return eligible
    const blockedAncestry =
      targetKind === "parent"
        ? descendantsOf(family.people, targetSourceId)
        : targetKind === "child"
          ? ancestorsOf(family.people, targetSourceId)
          : undefined
    for (const p of Object.values(family.people)) {
      if (p.id === targetSourceId || blockedAncestry?.has(p.id)) continue
      if (targetKind === "spouse" && targetSource.spouseIds.includes(p.id))
        continue
      if (
        targetKind === "parent"
        && targetSource.parents.some((l) => l.id === p.id)
      )
        continue
      if (
        targetKind === "child"
        && (p.parents.length >= 2
          || p.parents.some((l) => l.id === targetSourceId))
      )
        continue
      eligible.add(p.id)
    }
    return eligible
  }, [targetKind, targetSourceId, targetSource, family.people])

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
    return buildFlow(renderPeople, layout, selectedId, linking)
  }, [renderPeople, layout, selectedId, targetSourceId, linkEligible])

  // Print the whole tree to a PDF. Fits every node into a fixed page-sized box
  // (independent of the on-screen canvas, so nothing gets clipped by a narrower
  // print page), disables culling so off-screen nodes render, then hands off to
  // the browser's print dialog ("Save as PDF"). The viewport is restored after.
  const exportPdf = useCallback(async () => {
    // A4/Letter landscape printable area (10mm margin) in CSS px — fits both.
    const targetWidth = 960
    const targetHeight = 700
    const previous = getViewport()
    setPrinting(true)
    try {
      const bounds = getNodesBounds(getNodes())
      if (bounds.width > 0 && bounds.height > 0) {
        const viewport = getViewportForBounds(
          bounds,
          targetWidth,
          targetHeight,
          0.1,
          2,
          0.1,
        )
        await setViewport(viewport)
      } else {
        await fitView({ padding: 0.15, duration: 0 })
      }
    } catch (error) {
      console.error("Failed to fit tree for PDF export", error)
      try {
        await fitView({ padding: 0.15, duration: 0 })
      } catch {
        // Ignore — still open the print dialog below.
      }
    }
    // Let the new viewport + the culling toggle paint before snapshotting.
    await nextFrame()
    await nextFrame()
    const done = () => {
      document.body.classList.remove("exporting-pdf")
      setPrinting(false)
      void setViewport(previous)
      window.removeEventListener("afterprint", done)
    }
    window.addEventListener("afterprint", done)
    document.body.classList.add("exporting-pdf")
    window.print()
  }, [fitView, getNodes, getViewport, setViewport])

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
      openCreateFamily: (personId) => {
        if (!canEdit) return
        setSidebar({ mode: "createFamily", personId })
        setDrawerOpen(true)
        setSidebarHidden(false)
      },
      backToChoose: (kind, sourceId, rel) => {
        if (!canEdit) return
        setLink(undefined)
        setSidebar({ mode: "choose", kind, sourceId, rel })
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
      <ReactFlowProvider>
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
                className="absolute left-3 top-3 z-20 hidden h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-soft ring-1 ring-slate-200 transition-colors hover:bg-slate-50 active:scale-95 print:hidden md:inline-flex"
              >
                <PanelLeftOpen className="h-5 w-5" />
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
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => {
                if (sidebar.mode === "settings") return
                setLink(undefined)
                setSidebar({ mode: "idle" })
                setDrawerOpen(false)
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
                <Panel position="top-center">
                  <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl bg-emerald-600/85 py-1.5 pl-4 pr-1.5 text-xs text-white shadow-glass ring-1 ring-white/25 backdrop-blur-md sm:flex-nowrap sm:rounded-full sm:text-sm">
                    <Link2 className="h-4 w-4 shrink-0" />
                    <span>
                      {linkEligible && linkEligible.size === 0 ? (
                        <>
                          No one can be connected as <b>{targetSource.name}</b>
                          &rsquo;s {targetKind}
                        </>
                      ) : (
                        <>
                          Click a highlighted card to connect as{" "}
                          <b>{targetSource.name}</b>&rsquo;s {targetKind}
                          {targetKind !== "spouse"
                            && " · married couples connect together"}
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (link) setLink(undefined)
                        else {
                          setSidebar({ mode: "idle" })
                          setDrawerOpen(false)
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/30"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel (Esc)
                    </button>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </div>
        </div>
      </ReactFlowProvider>
    </TreeActionsContext.Provider>
  )
}
