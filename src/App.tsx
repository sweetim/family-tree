import "./index.css"
import "@xyflow/react/dist/style.css"

import { useEffect } from "react"
import { HashRouter, Navigate, Route, Routes, useParams } from "react-router"
import { ConfirmProvider } from "./components/Confirm"
import { HomePage } from "./components/HomePage"
import { ToastProvider } from "./components/Toast"
import { useSession } from "./lib/auth-client"
import { type TreeIndexStore, useTreeIndex } from "./store"
import { getSyncEngine } from "./sync/engine"
import { TreeView } from "./TreeView"

function TreeRoute({ index }: { index: TreeIndexStore }) {
  const { treeId, personId } = useParams()
  const tree = index.trees.find((t) => t.id === treeId)
  if (!tree)
    return (
      <Navigate
        to="/"
        replace
      />
    )
  return (
    <TreeView
      key={tree.id}
      tree={tree}
      allTrees={index.trees}
      openPersonId={personId}
    />
  )
}

/** Start/stop the sync engine with the session lifecycle. */
function useSyncEngine() {
  const { data: session } = useSession()
  useEffect(() => {
    if (!session) return
    const engine = getSyncEngine()
    engine.start()
    return () => engine.stop()
  }, [session])
}

export function App() {
  const index = useTreeIndex()
  useSyncEngine()

  return (
    <ToastProvider>
      <ConfirmProvider>
        <HashRouter>
          <Routes>
            <Route
              path="/"
              element={<HomePage index={index} />}
            />
            <Route
              path="/tree/:treeId"
              element={<TreeRoute index={index} />}
            />
            <Route
              path="/tree/:treeId/p/:personId"
              element={<TreeRoute index={index} />}
            />
            <Route
              path="*"
              element={
                <Navigate
                  to="/"
                  replace
                />
              }
            />
          </Routes>
        </HashRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
