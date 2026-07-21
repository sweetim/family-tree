"use client"

import { useParams } from "next/navigation"
import { useTreeIndex } from "@/store"
import { TreeView } from "@/TreeView"

export default function TreePage() {
  const params = useParams<{ treeId: string }>()
  const index = useTreeIndex()
  const tree = index.trees.find((t) => t.id === params?.treeId)
  if (!tree) return null
  return (
    <TreeView
      key={tree.id}
      tree={tree}
      allTrees={index.trees}
    />
  )
}
