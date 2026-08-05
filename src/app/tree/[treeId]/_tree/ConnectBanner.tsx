import { Panel } from "@xyflow/react"
import { Link2, X } from "lucide-react"
import type { LinkKind } from "@/lib/tree-actions"
import type { Person } from "@/types"

// The floating banner shown while click-to-connect is active. Tells the user
// whose relationship is being targeted and offers Esc/click to cancel.
export function ConnectBanner({
  targetKind,
  targetSource,
  linkEligible,
  onCancel,
}: {
  targetKind: LinkKind
  targetSource: Person
  linkEligible: Set<string> | undefined
  onCancel: () => void
}) {
  return (
    <Panel position="top-center">
      <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl bg-emerald-600/85 py-1.5 pl-4 pr-1.5 text-xs text-white shadow-glass ring-1 ring-white/25 backdrop-blur-md sm:flex-nowrap sm:rounded-full sm:text-sm">
        <Link2 className="h-4 w-4 shrink-0" />
        <span>
          {linkEligible && linkEligible.size === 0 ? (
            <>
              No one can be connected as <b>{targetSource.name}</b>
              &rsquo;s {targetKind}
            </>
          ) : (
            <>
              Click a highlighted card to connect as <b>{targetSource.name}</b>
              &rsquo;s {targetKind}
              {targetKind !== "spouse" && " · married couples connect together"}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/30"
        >
          <X className="h-3.5 w-3.5" /> Cancel (Esc)
        </button>
      </div>
    </Panel>
  )
}
