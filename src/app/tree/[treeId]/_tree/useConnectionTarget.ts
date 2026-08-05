import type { Dispatch, SetStateAction } from "react"
import { useEffect, useMemo, useState } from "react"
import type { LinkKind } from "@/lib/tree-actions"
import type { FamilyData } from "@/types"
import { ancestorsOf, descendantsOf } from "@/types"
import type { SidebarState } from "../_sidebar/Sidebar"

// Owns the click-to-connect lifecycle. A connection target can come from an
// explicit canvas link session (`link`) or from the sidebar's chooser panel
// (`sidebar` mode "choose"); both surface the same kind + source, so the canvas
// can highlight connectable cards and complete a connection on click as soon as
// the chooser opens, not only after pressing "Connect existing".
export function useConnectionTarget(
  sidebar: SidebarState,
  familyPeople: FamilyData,
  setSidebar: Dispatch<SetStateAction<SidebarState>>,
  setDrawerOpen: Dispatch<SetStateAction<boolean>>,
) {
  const [link, setLink] = useState<{ kind: LinkKind; sourceId: string }>()

  const chooserKind = sidebar.mode === "choose" ? sidebar.kind : undefined
  const chooserSourceId =
    sidebar.mode === "choose" ? sidebar.sourceId : undefined
  const targetKind = link?.kind ?? chooserKind
  const targetSourceId = link?.sourceId ?? chooserSourceId
  const targetSource = targetSourceId ? familyPeople[targetSourceId] : undefined

  // Cancel the active task if its source disappears (e.g. deleted from the sidebar).
  useEffect(() => {
    if (link && !targetSource) setLink(undefined)
  }, [link, targetSource])

  // Escape cancels the active link session, or closes the chooser panel.
  useEffect(() => {
    if (!targetKind) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (link) setLink(undefined)
      else {
        setSidebar({ mode: "idle" })
        setDrawerOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [targetKind, link, setSidebar, setDrawerOpen])

  // Who may be clicked to complete the pending connection. Mirrors the
  // sidebar's dropdown rules: max two parents, no duplicate links, and no
  // cycles (an ancestor can't become a child, a descendant can't become a parent).
  const linkEligible = useMemo(() => {
    if (!targetKind || !targetSourceId || !targetSource) return undefined
    const eligible = new Set<string>()
    if (targetKind === "parent" && targetSource.parents.length >= 2)
      return eligible
    const blockedAncestry =
      targetKind === "parent"
        ? descendantsOf(familyPeople, targetSourceId)
        : targetKind === "child"
          ? ancestorsOf(familyPeople, targetSourceId)
          : undefined
    for (const person of Object.values(familyPeople)) {
      if (person.id === targetSourceId || blockedAncestry?.has(person.id))
        continue
      if (targetKind === "spouse" && targetSource.spouseIds.includes(person.id))
        continue
      if (
        targetKind === "parent"
        && targetSource.parents.some((linkage) => linkage.id === person.id)
      )
        continue
      if (
        targetKind === "child"
        && (person.parents.length >= 2
          || person.parents.some((linkage) => linkage.id === targetSourceId))
      )
        continue
      eligible.add(person.id)
    }
    return eligible
  }, [targetKind, targetSourceId, targetSource, familyPeople])

  return {
    link,
    setLink,
    targetKind,
    targetSourceId,
    targetSource,
    linkEligible,
  }
}
