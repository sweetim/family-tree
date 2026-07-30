import { TriangleAlert } from "lucide-react"
import type { BlockedChange } from "@/store"

export function ReviewChangesPanel({
  changes,
  onClose,
}: {
  changes: BlockedChange[]
  onClose: () => void
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-800">
            Review changes
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-cobalt-600 transition-colors hover:text-cobalt-700"
        >
          Done
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm leading-relaxed text-amber-900">
          These changes could not be saved because this tree changed elsewhere.
          Your changes are preserved while they wait for review.
        </p>
      </div>

      <ul
        className="space-y-2"
        aria-label="Changes waiting for review"
      >
        {changes.map((change) => (
          <li
            key={change.id}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft"
          >
            <span className="block text-sm font-medium text-slate-700">
              {change.label}
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              Not saved to the server
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
