import { Check, ChevronDown, LoaderCircle, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { type BlockedChange, resolveBlockedOperation } from "@/store"

export function ReviewChangesPanel({
  changes,
  treeId,
}: {
  changes: BlockedChange[]
  treeId: string
}) {
  const [expandedId, setExpandedId] = useState<string>()
  const [resolving, setResolving] = useState<BlockedChange>()
  const [error, setError] = useState<{ id: string; message: string }>()
  const [banner, setBanner] = useState<string>()

  async function resolve(change: BlockedChange, side: "device" | "server") {
    setResolving(change)
    setError(undefined)
    setBanner(undefined)
    try {
      const result = await resolveBlockedOperation(change.id, side, treeId)
      if (result === "resolved") {
        setExpandedId(undefined)
      } else if (result === "conflict") {
        setError({
          id: change.id,
          message: "The server changed again. Review the refreshed versions.",
        })
      } else if (result === "unresolvable") {
        setError({
          id: change.id,
          message:
            "The server refused this change, and retrying cannot fix it. Use the server version.",
        })
      } else if (result === "stale") {
        setBanner(
          "This saved conflict is outdated. Close and reopen this tree to refresh it.",
        )
      } else {
        setError({
          id: change.id,
          message: "You are offline. Reconnect and try again.",
        })
      }
    } catch (error) {
      setError({
        id: change.id,
        message:
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
      })
    } finally {
      setResolving(undefined)
    }
  }

  const isResolving = resolving !== undefined
  const pinned =
    isResolving && !changes.some((change) => change.id === resolving.id)
      ? resolving
      : undefined
  const list = pinned ? [...changes, pinned] : changes

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-slate-800">Review changes</h2>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-4 py-10 text-center ring-1 ring-slate-200">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              You&apos;re all caught up
            </p>
            <p className="mt-1 text-sm text-slate-500">
              No changes waiting for review.
            </p>
          </div>
        </div>
      ) : (
        <>
          {banner && (
            <div className="rounded-xl bg-cobalt-50 px-4 py-3 ring-1 ring-cobalt-200">
              <p className="text-sm leading-relaxed text-cobalt-900">
                {banner}
              </p>
            </div>
          )}

          <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
            <p className="text-sm leading-relaxed text-amber-900">
              These changes could not be saved because this tree changed
              elsewhere. Your changes are preserved while they wait for review.
            </p>
          </div>

          <ul
            className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"
            aria-label="Changes waiting for review"
          >
            {list.map((change) => {
              const applying = isResolving && resolving.id === change.id
              return (
                <li key={change.id}>
                  <button
                    type="button"
                    disabled={applying}
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
                        {applying ? "Applying your changes..." : change.reason}
                      </span>
                    </span>
                    {applying ? (
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
                      {applying ? (
                        <div className="flex items-center gap-2 py-2 text-sm font-medium text-cobalt-600">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Applying your changes…
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(["device", "server"] as const).map((side) => (
                              <button
                                type="button"
                                key={side}
                                disabled={isResolving}
                                onClick={() => void resolve(change, side)}
                                className="rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-colors hover:bg-cobalt-50 hover:ring-cobalt-400 disabled:cursor-wait disabled:opacity-50"
                              >
                                <span className="text-xs font-semibold text-slate-700">
                                  {side === "device" ? "Your device" : "Server"}
                                </span>
                                {(side === "device"
                                  ? change.device
                                  : change.server
                                ).map((field) => (
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
                                ))}
                              </button>
                            ))}
                          </div>
                          {error?.id === change.id && (
                            <p className="mt-3 text-xs font-medium text-red-600">
                              {error.message}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
