"use client"

import { useParams } from "next/navigation"
import { useTreeIndex } from "@/store"
import { TreeView } from "@/TreeView"

export default function TreePersonPage() {
  const params = useParams<{ treeId: string; personId: string }>()
  const index = useTreeIndex()
  const tree = index.trees.find((t) => t.id === params?.treeId)
  if (!tree) return null
  return (
    <TreeView
      key={tree.id}
      tree={tree}
      allTrees={index.trees}
      openPersonId={params?.personId}
    />
  )
}
