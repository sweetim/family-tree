import { useParams } from "next/navigation"
import { type TreeMeta, useTreeIndex } from "@/store"

/**
 * Resolve the tree referenced by the current `[treeId]` route segment against
 * the store index. Returns the tree plus the full index (for cross-tree
 * navigation), or `undefined` when the tree id is not loaded for this user.
 */
export function useResolvedTree():
  | { tree: TreeMeta; allTrees: TreeMeta[] }
  | undefined {
  const params = useParams<{ treeId: string }>()
  const { trees } = useTreeIndex()
  const tree = trees.find((candidate) => candidate.id === params?.treeId)
  if (!tree) return undefined
  return { tree, allTrees: trees }
}
