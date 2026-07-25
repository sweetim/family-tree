import { createContext, useContext } from "react"
import type { Relationship } from "../types"

export type LinkKind = "spouse" | "parent" | "child"

export interface TreeActions {
  /** Open the sidebar's "add member" form with a preset relationship. */
  openAdd: (rel: Relationship) => void
  /** Open the sidebar chooser that asks the user to add a new person or connect an existing one. */
  openChoose: (kind: LinkKind, sourceId: string, rel: Relationship) => void
  /** Return from an add/connect panel back to the chooser, cancelling any active click-to-connect. */
  backToChoose: (kind: LinkKind, sourceId: string, rel: Relationship) => void
  /** Start click-to-connect: the next eligible card clicked becomes source's spouse/parent/child. */
  startLink: (kind: LinkKind, sourceId: string) => void
  /** Open the sidebar editor for a couple's marriage date (from a union-dot click). */
  editMarriage: (a: string, b: string) => void
  /** True when the current user is a viewer on this tree — hides mutating affordances. */
  readOnly: boolean
}

export const TreeActionsContext = createContext<TreeActions | null>(null)

export function useTreeActions(): TreeActions {
  const ctx = useContext(TreeActionsContext)
  if (!ctx)
    throw new Error("useTreeActions must be used inside TreeActionsContext")
  return ctx
}
