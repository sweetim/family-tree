import { ChevronLeft } from "lucide-react"
import { type LinkKind, useTreeActions } from "@/lib/tree-actions"
import type { Relationship } from "@/types"

/** Small "back to selection" link that returns an add/connect panel to the chooser. */
export function BackToChoose({
  kind,
  sourceId,
  rel,
}: {
  kind: LinkKind
  sourceId: string
  rel: Relationship
}) {
  const { backToChoose } = useTreeActions()
  return (
    <button
      type="button"
      title="Back to selection"
      onClick={() => backToChoose(kind, sourceId, rel)}
      className="-ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-cobalt-600"
    >
      <ChevronLeft className="h-3.5 w-3.5" /> Selection
    </button>
  )
}
