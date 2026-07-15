import "./index.css";
import "@xyflow/react/dist/style.css";

import { HashRouter, Navigate, Route, Routes, useParams } from "react-router";
import { ConfirmProvider } from "./components/Confirm";
import { ToastProvider } from "./components/Toast";
import { HomePage } from "./components/HomePage";
import { useTreeIndex, type TreeIndexStore } from "./store";
import { TreeView } from "./TreeView";

function TreeRoute({ index }: { index: TreeIndexStore }) {
  const { treeId, personId } = useParams();
  const tree = index.trees.find(t => t.id === treeId);
  if (!tree) return <Navigate to="/" replace />;
  return <TreeView key={tree.id} tree={tree} allTrees={index.trees} openPersonId={personId} />;
}

export function App() {
  const index = useTreeIndex();

  return (
    <ToastProvider>
      <ConfirmProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage index={index} />} />
            <Route path="/tree/:treeId" element={<TreeRoute index={index} />} />
            <Route path="/tree/:treeId/p/:personId" element={<TreeRoute index={index} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default App;
