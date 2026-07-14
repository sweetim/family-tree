import "./index.css";
import "@xyflow/react/dist/style.css";

import { useEffect, useState } from "react";
import { HomePage } from "./components/HomePage";
import { useTreeIndex } from "./store";
import { TreeView } from "./TreeView";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const index = useTreeIndex();
  const hash = useHashRoute();

  const treeId = hash.match(/^#\/tree\/(.+)$/)?.[1];
  const tree = treeId ? index.trees.find(t => t.id === treeId) : undefined;

  if (!tree) return <HomePage index={index} />;
  return <TreeView key={tree.id} tree={tree} />;
}

export default App;
