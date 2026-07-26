"use client"

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"

type TreeEditMode = {
  editingTreeId: string | null
  setEditingTreeId: (treeId: string | null) => void
  getEditingSession: (treeId: string) => number | null
  isTreeEditing: (treeId: string) => boolean
}

const TreeEditModeContext = createContext<TreeEditMode | null>(null)

export function TreeEditModeProvider({ children }: { children: ReactNode }) {
  const [editingTreeId, setEditingTreeId] = useState<string | null>(null)
  const editingTreeIdRef = useRef<string | null>(null)
  const editingSessionRef = useRef(0)
  const updateEditingTreeId = useCallback((treeId: string | null) => {
    editingSessionRef.current += 1
    editingTreeIdRef.current = treeId
    setEditingTreeId(treeId)
  }, [])
  const getEditingSession = useCallback(
    (treeId: string) =>
      editingTreeIdRef.current === treeId ? editingSessionRef.current : null,
    [],
  )
  const isTreeEditing = useCallback(
    (treeId: string) => editingTreeIdRef.current === treeId,
    [],
  )

  return (
    <TreeEditModeContext.Provider
      value={{
        editingTreeId,
        setEditingTreeId: updateEditingTreeId,
        getEditingSession,
        isTreeEditing,
      }}
    >
      {children}
    </TreeEditModeContext.Provider>
  )
}

export function useTreeEditMode(): TreeEditMode {
  const context = useContext(TreeEditModeContext)
  if (!context) {
    throw new Error("useTreeEditMode must be used inside TreeEditModeProvider")
  }
  return context
}
