import { Check, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { type BlockedChange, resolveBlockedOperation } from "@/store"

export function ReviewChangesPanel({
  changes,
  onClose,
}: {
  changes: BlockedChange[]
  onClose: () => void
}) {
  const [selections, setSelections] = useState<
    Record<string, "device" | "server">
  >({})

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

      <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <p className="text-sm leading-relaxed text-amber-900">
          These changes could not be saved because this tree changed elsewhere.
          Your changes are preserved while they wait for review.
        </p>
      </div>

      <ul
        className="space-y-2"
        aria-label="Changes waiting for review"
      >
        {changes.map((change) => {
          const selected = selections[change.id]
          return (
            <li
              key={change.id}
              className="py-4 first:pt-0 last:pb-0"
            >
              <span className="block text-sm font-medium text-slate-700">
                {change.label}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {change.reason}
              </span>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(["device", "server"] as const).map((side) => (
                  <button
                    type="button"
                    key={side}
                    disabled={side === "device" && !change.retryable}
                    onClick={() =>
                      setSelections((current) => ({
                        ...current,
                        [change.id]: side,
                      }))
                    }
                    className={`relative rounded-xl p-3 text-left ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected === side
                        ? "bg-cobalt-50 ring-2 ring-cobalt-500"
                        : "bg-slate-50 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                      {side === "device" ? "Your device" : "Server"}
                      {selected === side && (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cobalt-600 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </span>
                    {(side === "device" ? change.device : change.server).map(
                      (field) => (
                        <div
                          key={`${field.label}:${field.value}`}
                          className="mt-2 text-xs"
                        >
                          <span className="block text-slate-400">
                            {field.label}
                          </span>
                          <span className="break-words text-slate-700">
                            {field.value}
                          </span>
                        </div>
                      ),
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return
                  resolveBlockedOperation(change.id, selected)
                  setSelections((current) => {
                    const next = { ...current }
                    delete next[change.id]
                    return next
                  })
                }}
                className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-cobalt-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                Apply selected version
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
