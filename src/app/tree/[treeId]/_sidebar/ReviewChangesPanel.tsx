import { ChevronDown, LoaderCircle, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { type BlockedChange, resolveBlockedOperation } from "@/store"

export function ReviewChangesPanel({
  changes,
  onClose,
}: {
  changes: BlockedChange[]
  onClose: () => void
}) {
  const [expandedId, setExpandedId] = useState<string>()
  const [resolvingId, setResolvingId] = useState<string>()
  const [errorId, setErrorId] = useState<string>()

  async function resolve(change: BlockedChange, side: "device" | "server") {
    setResolvingId(change.id)
    setErrorId(undefined)
    const resolved = await resolveBlockedOperation(change.id, side)
    setResolvingId(undefined)
    if (resolved) setExpandedId(undefined)
    else setErrorId(change.id)
  }

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
        className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"
        aria-label="Changes waiting for review"
      >
        {changes.map((change) => (
          <li key={change.id}>
            <button
              type="button"
              disabled={resolvingId === change.id}
              onClick={() =>
                setExpandedId((current) =>
                  current === change.id ? undefined : change.id,
                )
              }
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-wait"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-700">
                  {change.label}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {resolvingId === change.id ? "Applying..." : change.reason}
                </span>
              </span>
              {resolvingId === change.id ? (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-cobalt-600" />
              ) : (
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                    expandedId === change.id ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>
            {expandedId === change.id && (
              <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-4 pt-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["device", "server"] as const).map((side) => (
                    <button
                      type="button"
                      key={side}
                      disabled={
                        resolvingId === change.id
                        || (side === "device" && !change.retryable)
                      }
                      onClick={() => void resolve(change, side)}
                      className="rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-colors hover:bg-cobalt-50 hover:ring-cobalt-400 disabled:cursor-wait disabled:opacity-50"
                    >
                      <span className="text-xs font-semibold text-slate-700">
                        {side === "device" ? "Your device" : "Server"}
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
                {errorId === change.id && (
                  <p className="mt-3 text-xs font-medium text-red-600">
                    This change could not be applied. Review the latest versions
                    and try again.
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
