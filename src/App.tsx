import "./index.css";
import "@xyflow/react/dist/style.css";

import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import { PersonNode } from "./components/PersonNode";
import { Sidebar, type SidebarState } from "./components/Sidebar";
import { UnionNode } from "./components/UnionNode";
import { buildFlow, type FlowEdge, type FlowNode } from "./lib/layout";
import { TreeActionsContext, type TreeActions } from "./lib/tree-actions";
import { useFamily } from "./store";

const nodeTypes = { person: PersonNode, union: UnionNode };

export function App() {
  const family = useFamily();
  const [sidebar, setSidebar] = useState<SidebarState>({ mode: "idle" });

  const selectedId = sidebar.mode === "edit" ? sidebar.personId : undefined;
  const { nodes, edges } = useMemo(
    () => buildFlow(family.people, selectedId),
    [family.people, selectedId],
  );

  const actions = useMemo<TreeActions>(
    () => ({ openAdd: rel => setSidebar({ mode: "add", rel }) }),
    [],
  );

  const onNodeClick: NodeMouseHandler<FlowNode> = (_e, node) => {
    if (node.type === "person") setSidebar({ mode: "edit", personId: node.id });
  };

  const onEdgeClick: EdgeMouseHandler<FlowEdge> = (_e, edge) => {
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
          state={sidebar}
          onSelect={id => setSidebar({ mode: "edit", personId: id })}
          onAddRoot={() => setSidebar({ mode: "add", rel: { kind: "root" } })}
          onClose={() => setSidebar({ mode: "idle" })}
        />

        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => setSidebar({ mode: "idle" })}
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
          </ReactFlow>
        </div>
      </div>
    </TreeActionsContext.Provider>
  );
}

export default App;
