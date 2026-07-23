import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  MiniMap,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
} from "@xyflow/react"
import {
  Check,
  Crosshair,
  Link2,
  Maximize2,
  Menu,
  PanelLeftOpen,
  Pencil,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useConfirm } from "@/components/Confirm"
import { PersonNode } from "@/components/PersonNode"
import { UnionNode } from "@/components/UnionNode"
import {
  buildFlow,
  type FamilyRoot,
  type FlowEdge,
  type FlowNode,
  findRoots,
  withCollapsedRoots,
} from "@/lib/layout"
import {
  type LinkKind,
  type TreeActions,
  TreeActionsContext,
} from "@/lib/tree-actions"
import { useViewSettings } from "@/lib/view-settings"
import { type TreeMeta, useFamily } from "@/store"
import {
  ancestorsOf,
  descendantsOf,
  type FamilyData,
  focusFamily,
} from "@/types"
import { Sidebar, type SidebarState } from "../_sidebar/Sidebar"

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
  const family = useFamily(tree.id)
  const confirm = useConfirm()
  const { settings } = useViewSettings()
  const [sidebar, setSidebar] = useState<SidebarState>(() =>
    openPersonId ? { mode: "edit", personId: openPersonId } : { mode: "idle" },
  )
  const [focusId, setFocusId] = useState<string>()
  const [link, setLink] = useState<{ kind: LinkKind; sourceId: string }>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  // Follow cross-tree jumps that land on this already-mounted tree.
  useEffect(() => {
    if (openPersonId) {
      setSidebar({ mode: "edit", personId: openPersonId })
      setDrawerOpen(true)
      setSidebarHidden(false)
    }
  }, [openPersonId])

  // Desktop has no Edit toggle — it stays editable (hover-to-add). Mobile
  // defaults to read-only until the user taps Edit. Viewport width is read
  // after mount to avoid an SSR/hydration mismatch.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  const canEdit = !family.readOnly && (isDesktop || editMode)

  const focusPerson = focusId ? family.people[focusId] : undefined
  const visiblePeople = useMemo(
    () =>
      focusPerson ? focusFamily(family.people, focusPerson.id) : family.people,
    [family.people, focusPerson],
  )

  const roots = useMemo(() => findRoots(visiblePeople), [visiblePeople])
  const [activeRootId, setActiveRootId] = useState<string>()

  // In single-root mode keep an expanded root selected: default to the first
  // root, and reset if the active one disappeared (e.g. its family merged or
  // was deleted).
  useEffect(() => {
    if (settings.multiRoot) return
    if (!roots.some((r) => r.id === activeRootId)) {
      setActiveRootId(roots[0]?.id)
    }
  }, [roots, activeRootId, settings.multiRoot])

  const activeRoot = settings.multiRoot
    ? undefined
    : (roots.find((r) => r.id === activeRootId) ?? roots[0])

  const activeMembers = useMemo<FamilyData>(() => {
    if (!activeRoot) return visiblePeople
    const subset: FamilyData = {}
    for (const id of activeRoot.members) {
      const person = visiblePeople[id]
      if (person) subset[id] = person
    }
    return subset
  }, [visiblePeople, activeRoot])

  const collapsedRoots = useMemo<FamilyRoot[]>(
    () => (activeRoot ? roots.filter((r) => r.id !== activeRoot.id) : []),
    [roots, activeRoot],
  )

  const linkSource = link ? family.people[link.sourceId] : undefined

  // Cancel link mode if the source disappears (e.g. deleted from the sidebar).
  useEffect(() => {
    if (link && !linkSource) setLink(undefined)
  }, [link, linkSource])

  useEffect(() => {
    if (!link) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLink(undefined)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [link])

  // Who may be clicked to complete the pending connection. Mirrors the
  // sidebar's dropdown rules: max two parents, no duplicate links, and no
  // cycles (an ancestor can't become a child, a descendant can't become a parent).
  const linkEligible = useMemo(() => {
    if (!link || !linkSource) return undefined
    const eligible = new Set<string>()
    if (link.kind === "parent" && linkSource.parents.length >= 2)
      return eligible
    const blockedAncestry =
      link.kind === "parent"
        ? descendantsOf(family.people, linkSource.id)
        : link.kind === "child"
          ? ancestorsOf(family.people, linkSource.id)
          : undefined
    for (const p of Object.values(visiblePeople)) {
      if (p.id === linkSource.id || blockedAncestry?.has(p.id)) continue
      if (link.kind === "spouse" && linkSource.spouseIds.includes(p.id))
        continue
      if (
        link.kind === "parent"
        && linkSource.parents.some((l) => l.id === p.id)
      )
        continue
      if (
        link.kind === "child"
        && (p.parents.length >= 2
          || p.parents.some((l) => l.id === linkSource.id))
      )
        continue
      eligible.add(p.id)
    }
    return eligible
  }, [link, linkSource, family.people, visiblePeople])

  const selectedId = sidebar.mode === "edit" ? sidebar.personId : undefined
  const { nodes, edges } = useMemo(() => {
    const flow = buildFlow(
      activeMembers,
      selectedId,
      link && linkEligible
        ? { sourceId: link.sourceId, eligible: linkEligible }
        : undefined,
    )
    return collapsedRoots.length > 0
      ? withCollapsedRoots(flow, collapsedRoots, visiblePeople)
      : flow
  }, [
    activeMembers,
    selectedId,
    link,
    linkEligible,
    collapsedRoots,
    visiblePeople,
  ])

  const actions = useMemo<TreeActions>(
    () => ({
      openAdd: (rel) => {
        setSidebar({ mode: "add", rel })
        setDrawerOpen(true)
      },
      startLink: (kind, sourceId) => setLink({ kind, sourceId }),
      readOnly: !canEdit,
    }),
    [canEdit],
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
    if (node.type !== "person") return
    if (link) {
      if (node.id === link.sourceId) return setLink(undefined)
      if (!linkEligible?.has(node.id)) return
      if (link.kind === "spouse") family.linkSpouse(link.sourceId, node.id)
      else if (link.kind === "parent")
        linkCoupleAsParents(link.sourceId, node.id)
      else linkCoupleAsParents(node.id, link.sourceId)
      setLink(undefined)
      return
    }
    // A collapsed root card expands its family instead of opening the editor.
    if (node.data.collapsedRoot) {
      setActiveRootId(node.id)
      return
    }
    setSidebar({ mode: "edit", personId: node.id })
    setDrawerOpen(true)
    setSidebarHidden(false)
  }

  const onEdgeClick: EdgeMouseHandler<FlowEdge> = async (_e, edge) => {
    if (link) return
    const data = edge.data
    if (!data) return

    if (data.kind === "couple" && data.a && data.b) {
      const a = family.people[data.a]
      const b = family.people[data.b]
      if (!a || !b) return
      if (!a.spouseIds.includes(b.id)) return // co-parent line only, no marriage to remove
      if (
        await confirm({
          title: "Remove marriage",
          message: `Remove the marriage between ${a.name} and ${b.name}?`,
          confirmText: "Remove",
          tone: "danger",
        })
      ) {
        family.unlinkSpouse(a.id, b.id)
      }
    } else if (data.kind === "child" && data.childId && data.parentIds) {
      const child = family.people[data.childId]
      if (!child) return
      const names = data.parentIds
        .map((id) => family.people[id]?.name)
        .filter(Boolean)
        .join(" and ")
      if (
        await confirm({
          title: "Detach child",
          message: `Detach ${child.name} from ${names}?`,
          confirmText: "Detach",
          tone: "danger",
        })
      ) {
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
    const persons = toDelete.filter((n) => n.type === "person")
    if (persons.length === 0) return false
    const names = persons.map((n) => n.data.person.name).join(", ")
    return await confirm({
      title: "Delete people",
      message: `Delete ${names} from ALL trees?`,
      confirmText: "Delete",
      tone: "danger",
    })
  }

  const onNodesDelete = (deleted: FlowNode[]) => {
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
          collapsed={sidebarHidden}
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
          onFocus={(id) => {
            setFocusId(id)
            setDrawerOpen(false)
          }}
          onOpenSettings={() => {
            setSidebar({ mode: "settings" })
            setDrawerOpen(true)
            setSidebarHidden(false)
          }}
          onClose={() => {
            setSidebar({ mode: "idle" })
            setDrawerOpen(false)
          }}
        />

        {drawerOpen && (
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm md:hidden"
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
              className="absolute left-3 top-3 z-20 hidden h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-soft ring-1 ring-slate-200 transition-colors hover:bg-slate-50 active:scale-95 md:inline-flex"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          )}
          <div className="absolute left-3 top-3 z-20 flex items-center gap-2 md:hidden">
            <button
              aria-label="Open panel"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-soft ring-1 ring-slate-200 transition-colors hover:bg-slate-50 active:scale-95"
              type="button"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            {!family.readOnly && (
              <button
                aria-label={editMode ? "Done editing" : "Edit tree"}
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium shadow-soft ring-1 transition-colors active:scale-95 ${
                  editMode
                    ? "bg-cobalt-600 text-white ring-cobalt-600 hover:bg-cobalt-700"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {editMode ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                {editMode ? "Done" : "Edit"}
              </button>
            )}
          </div>
          <ReactFlow
            key={`${focusPerson?.id ?? "all"}:${settings.multiRoot ? "multi" : (activeRootId ?? "none")}`}
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
            deleteKeyCode={family.readOnly ? [] : ["Delete", "Backspace"]}
            onBeforeDelete={onBeforeDelete}
            onNodesDelete={onNodesDelete}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.1}
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

            {link && linkSource && (
              <Panel position="top-center">
                <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl bg-emerald-600/85 py-1.5 pl-4 pr-1.5 text-xs text-white shadow-glass ring-1 ring-white/25 backdrop-blur-md sm:flex-nowrap sm:rounded-full sm:text-sm">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>
                    {linkEligible && linkEligible.size === 0 ? (
                      <>
                        No one can be connected as <b>{linkSource.name}</b>
                        &rsquo;s {link.kind}
                      </>
                    ) : (
                      <>
                        Click a highlighted card to connect as{" "}
                        <b>{linkSource.name}</b>&rsquo;s {link.kind}
                        {link.kind !== "spouse"
                          && " · married couples connect together"}
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLink(undefined)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/30"
                  >
                    <X className="h-3.5 w-3.5" /> Cancel (Esc)
                  </button>
                </div>
              </Panel>
            )}

            {focusPerson && (
              <Panel position="top-center">
                <div className="glass flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl py-1.5 pl-4 pr-1.5 text-xs text-white shadow-glass ring-1 ring-white/25 sm:flex-nowrap sm:rounded-full sm:text-sm">
                  <Crosshair className="h-4 w-4 shrink-0" />
                  <span>
                    Viewing <b>{focusPerson.name}</b>&rsquo;s family ·{" "}
                    {Object.keys(visiblePeople).length} of{" "}
                    {Object.keys(family.people).length} people
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusId(undefined)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/30"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> Show everyone
                  </button>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>
    </TreeActionsContext.Provider>
  )
}
