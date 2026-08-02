"use client"

import { useParams } from "next/navigation"
import { useResolvedTree } from "@/lib/use-resolved-tree"
import { TreeNotFound } from "../../_not-found/TreeNotFound"
import { TreeView } from "../../_tree/TreeView"

export default function TreePersonPage() {
  const resolved = useResolvedTree()
  const { personId } = useParams<{ personId: string }>()
  if (!resolved) return <TreeNotFound />
  return (
    <TreeView
      key={resolved.tree.id}
      tree={resolved.tree}
      allTrees={resolved.allTrees}
      openPersonId={personId}
    />
  )
}
