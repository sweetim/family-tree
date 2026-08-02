import { Link2, UserPlus } from "lucide-react"
import { type LinkKind, useTreeActions } from "@/lib/tree-actions"
import type { Relationship } from "@/types"

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
  createFamily,
  alsoCreateFamily,
}: {
  kind: LinkKind
  sourceId: string
  sourceName: string
  rel: Relationship
  createFamily?: boolean
  alsoCreateFamily?: boolean
}) {
  const { openAdd, openCreateFamily, startLink } = useTreeActions()
  const role = ROLE_LABEL[kind]

  return (
    <div className="animate-slide-up space-y-4">
      <div>
        <div>
          <h2 className="text-base font-semibold text-slate-800 capitalize">
            Add {role}
          </h2>
          <p className="text-xs text-slate-500">For {sourceName}</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() =>
            createFamily ? openCreateFamily(sourceId) : openAdd(rel)
          }
          className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-cobalt-300 hover:bg-cobalt-50/40 active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-600 text-white transition-colors group-hover:bg-cobalt-700">
            <UserPlus className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              {createFamily ? "Create new family" : `Add new ${role}`}
            </span>
            <span className="block text-xs text-slate-500">
              {createFamily
                ? "Start a separate family tree for their parents"
                : "Create a new person and link them"}
            </span>
          </span>
        </button>

        {alsoCreateFamily && !createFamily && (
          <button
            type="button"
            onClick={() => openCreateFamily(sourceId)}
            className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-cobalt-300 hover:bg-cobalt-50/40 active:scale-[0.98]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-600 text-white transition-colors group-hover:bg-cobalt-700">
              <UserPlus className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">
                Create new family
              </span>
              <span className="block text-xs text-slate-500">
                Start a separate family tree for their parents
              </span>
            </span>
          </button>
        )}

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
              Link a person already in the tree or another family
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}
