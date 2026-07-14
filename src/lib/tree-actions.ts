import { createContext, useContext } from "react";
import type { Relationship } from "../types";

export type LinkKind = "spouse" | "parent" | "child";

export interface TreeActions {
  /** Open the sidebar's "add member" form with a preset relationship. */
  openAdd: (rel: Relationship) => void;
  /** Start click-to-connect: the next eligible card clicked becomes source's spouse/parent/child. */
  startLink: (kind: LinkKind, sourceId: string) => void;
  /** Display name of a tree, for cross-tree link badges. */
  treeNameOf: (treeId: string) => string | undefined;
}

export const TreeActionsContext = createContext<TreeActions | null>(null);

export function useTreeActions(): TreeActions {
  const ctx = useContext(TreeActionsContext);
  if (!ctx) throw new Error("useTreeActions must be used inside TreeActionsContext");
  return ctx;
}
