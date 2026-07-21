"use client"

import { HomePage } from "@/components/HomePage"
import { useTreeIndex } from "@/store"

export default function Page() {
  const index = useTreeIndex()
  return <HomePage index={index} />
}
