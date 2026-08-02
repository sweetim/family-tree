"use client"

import { useResolvedTree } from "@/lib/use-resolved-tree"
import { TreeNotFound } from "./_not-found/TreeNotFound"
import { TreeView } from "./_tree/TreeView"

export default function TreePage() {
  const resolved = useResolvedTree()
  if (resolved) {
    return (
      <TreeView
        key={resolved.tree.id}
        tree={resolved.tree}
        allTrees={resolved.allTrees}
      />
    )
  }
  return <TreeNotFound />
}
