import { Link2, UserPlus, X } from "lucide-react"
import { type LinkKind, useTreeActions } from "@/lib/tree-actions"
import type { Relationship } from "@/types"
import { ghostBtn } from "./shared"

const ROLE_LABEL: Record<LinkKind, string> = {
  parent: "parent",
  spouse: "spouse",
  child: "child",
}

export function ChoosePanel({
  kind,
  sourceId,
  sourceName,
  rel,
  onClose,
}: {
  kind: LinkKind
  sourceId: string
  sourceName: string
  rel: Relationship
  onClose: () => void
}) {
  const { openAdd, startLink } = useTreeActions()
  const role = ROLE_LABEL[kind]

  return (
    <div className="animate-slide-up space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800 capitalize">
            Add {role}
          </h2>
          <p className="text-xs text-slate-500">For {sourceName}</p>
        </div>
        <button
          type="button"
          title="Close"
          className={ghostBtn}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => openAdd(rel)}
          className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-cobalt-300 hover:bg-cobalt-50/40 active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-600 text-white transition-colors group-hover:bg-cobalt-700">
            <UserPlus className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              Add new {role}
            </span>
            <span className="block text-xs text-slate-500">
              Create a new person and link them
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => startLink(kind, sourceId)}
          className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-cobalt-300 hover:bg-cobalt-50/40 active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cobalt-300 bg-white text-cobalt-600 transition-colors group-hover:bg-cobalt-50">
            <Link2 className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              Connect existing {role}
            </span>
            <span className="block text-xs text-slate-500">
              Link a person already in the tree
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}
