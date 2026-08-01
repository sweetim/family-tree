"use client"

import { SharingPage } from "@/components/SharingPage"
import { useTreeIndex } from "@/store"

export default function Page() {
  const index = useTreeIndex()
  return <SharingPage index={index} />
}
