import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import { PersonNode } from "./components/PersonNode";
import { Sidebar, type SidebarState } from "./components/Sidebar";
import { UnionNode } from "./components/UnionNode";
import { buildFlow, type FlowEdge, type FlowNode } from "./lib/layout";
import { TreeActionsContext, type LinkKind, type TreeActions } from "./lib/tree-actions";
import { useFamily, type TreeMeta } from "./store";
import { ancestorsOf, descendantsOf, focusFamily } from "./types";

const nodeTypes = { person: PersonNode, union: UnionNode };

export function TreeView({ tree }: { tree: TreeMeta }) {
  const family = useFamily(tree.id);
  const [sidebar, setSidebar] = useState<SidebarState>({ mode: "idle" });
  const [focusId, setFocusId] = useState<string>();
  const [link, setLink] = useState<{ kind: LinkKind; sourceId: string }>();

  const focusPerson = focusId ? family.people[focusId] : undefined;
  const visiblePeople = useMemo(
    () => (focusPerson ? focusFamily(family.people, focusPerson.id) : family.people),
    [family.people, focusPerson],
  );

  const linkSource = link ? family.people[link.sourceId] : undefined;

  // Cancel link mode if the source disappears (e.g. deleted from the sidebar).
  useEffect(() => {
    if (link && !linkSource) setLink(undefined);
  }, [link, linkSource]);

  useEffect(() => {
    if (!link) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLink(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [link]);

  // Who may be clicked to complete the pending connection. Mirrors the
  // sidebar's dropdown rules: max two parents, no duplicate links, and no
  // cycles (an ancestor can't become a child, a descendant can't become a parent).
  const linkEligible = useMemo(() => {
    if (!link || !linkSource) return undefined;
    const eligible = new Set<string>();
    if (link.kind === "parent" && linkSource.parents.length >= 2) return eligible;
    const blockedAncestry =
      link.kind === "parent"
        ? descendantsOf(family.people, linkSource.id)
        : link.kind === "child"
          ? ancestorsOf(family.people, linkSource.id)
          : undefined;
    for (const p of Object.values(visiblePeople)) {
      if (p.id === linkSource.id || blockedAncestry?.has(p.id)) continue;
      if (link.kind === "spouse" && linkSource.spouseIds.includes(p.id)) continue;
      if (link.kind === "parent" && linkSource.parents.some(l => l.id === p.id)) continue;
      if (link.kind === "child" && (p.parents.length >= 2 || p.parents.some(l => l.id === linkSource.id))) continue;
      eligible.add(p.id);
    }
    return eligible;
  }, [link, linkSource, family.people, visiblePeople]);

  const selectedId = sidebar.mode === "edit" ? sidebar.personId : undefined;
  const { nodes, edges } = useMemo(
    () =>
      buildFlow(
        visiblePeople,
        selectedId,
        link && linkEligible ? { sourceId: link.sourceId, eligible: linkEligible } : undefined,
      ),
    [visiblePeople, selectedId, link, linkEligible],
  );

  const actions = useMemo<TreeActions>(
    () => ({
      openAdd: rel => setSidebar({ mode: "add", rel }),
      startLink: (kind, sourceId) => setLink({ kind, sourceId }),
    }),
    [],
  );

  // Linking a married person as a parent brings their spouse into the other
  // parent slot, so the child hangs from the couple. addParent's own guards
  // skip spouses that are duplicates, over the two-parent cap, or would cycle.
  const linkCoupleAsParents = (childId: string, parentId: string) => {
    family.addParent(childId, parentId);
    for (const sid of family.people[parentId]?.spouseIds ?? []) {
      family.addParent(childId, sid);
    }
  };

  const onNodeClick: NodeMouseHandler<FlowNode> = (_e, node) => {
    if (node.type !== "person") return;
    if (link) {
      if (node.id === link.sourceId) return setLink(undefined);
      if (!linkEligible?.has(node.id)) return;
      if (link.kind === "spouse") family.linkSpouse(link.sourceId, node.id);
      else if (link.kind === "parent") linkCoupleAsParents(link.sourceId, node.id);
      else linkCoupleAsParents(node.id, link.sourceId);
      setLink(undefined);
      return;
    }
    setSidebar({ mode: "edit", personId: node.id });
  };

  const onEdgeClick: EdgeMouseHandler<FlowEdge> = (_e, edge) => {
    if (link) return;
    const data = edge.data;
    if (!data) return;

    if (data.kind === "couple" && data.a && data.b) {
      const a = family.people[data.a];
      const b = family.people[data.b];
      if (!a || !b) return;
      if (!a.spouseIds.includes(b.id)) return; // co-parent line only, no marriage to remove
      if (confirm(`Remove the marriage between ${a.name} and ${b.name}?`)) {
        family.unlinkSpouse(a.id, b.id);
      }
    } else if (data.kind === "child" && data.childId && data.parentIds) {
      const child = family.people[data.childId];
      if (!child) return;
      const names = data.parentIds
        .map(id => family.people[id]?.name)
        .filter(Boolean)
        .join(" and ");
      if (confirm(`Detach ${child.name} from ${names}?`)) {
        for (const pid of data.parentIds) family.removeParent(child.id, pid);
      }
    }
  };

  const onBeforeDelete = async ({ nodes: toDelete }: { nodes: FlowNode[]; edges: Edge[] }) => {
    const persons = toDelete.filter(n => n.type === "person");
    if (persons.length === 0) return false;
    const names = persons.map(n => n.data.person.name).join(", ");
    return confirm(`Remove ${names} from the tree?`);
  };

  const onNodesDelete = (deleted: FlowNode[]) => {
    for (const node of deleted) {
      if (node.type === "person") family.deletePerson(node.id);
    }
    setSidebar({ mode: "idle" });
  };

  return (
    <TreeActionsContext.Provider value={actions}>
      <div className="flex h-screen w-screen bg-slate-50">
        <Sidebar
          family={family}
          treeName={tree.name}
          state={sidebar}
          onSelect={id => setSidebar({ mode: "edit", personId: id })}
          onAddRoot={() => setSidebar({ mode: "add", rel: { kind: "root" } })}
          onFocus={setFocusId}
          onClose={() => setSidebar({ mode: "idle" })}
        />

        <div className="min-w-0 flex-1">
          <ReactFlow
            key={focusPerson?.id ?? "all"}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => {
              setLink(undefined);
              setSidebar({ mode: "idle" });
            }}
            deleteKeyCode={["Delete", "Backspace"]}
            onBeforeDelete={onBeforeDelete}
            onNodesDelete={onNodesDelete}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            nodesConnectable={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} color="#cbd5e1" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-slate-100" />

            {link && linkSource && (
              <Panel position="top-center">
                <div className="flex items-center gap-3 rounded-full bg-emerald-600 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-md">
                  <span>
                    {linkEligible && linkEligible.size === 0 ? (
                      <>
                        No one can be connected as <b>{linkSource.name}</b>&rsquo;s {link.kind}
                      </>
                    ) : (
                      <>
                        Click a highlighted card to connect as <b>{linkSource.name}</b>&rsquo;s{" "}
                        {link.kind}
                      </>
                    )}
                  </span>
                  <button
                    onClick={() => setLink(undefined)}
                    className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30"
                  >
                    Cancel (Esc)
                  </button>
                </div>
              </Panel>
            )}

            {focusPerson && (
              <Panel position="top-center">
                <div className="flex items-center gap-3 rounded-full bg-indigo-600 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-md">
                  <span>
                    Viewing <b>{focusPerson.name}</b>&rsquo;s family ·{" "}
                    {Object.keys(visiblePeople).length} of {Object.keys(family.people).length} people
                  </span>
                  <button
                    onClick={() => setFocusId(undefined)}
                    className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30"
                  >
                    Show everyone
                  </button>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>
    </TreeActionsContext.Provider>
  );
}
