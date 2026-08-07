import {
  ChevronDown,
  Heart,
  History,
  Pencil,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react"
import { type ReactNode, useMemo } from "react"
import { match } from "ts-pattern"
import {
  type ActivityIcon,
  formatRelativeTime,
  useTreeActivity,
} from "@/lib/activity"
import type { FamilyStore } from "@/store"

const ICON_TONE: Record<ActivityIcon, string> = {
  add: "bg-emerald-50 text-emerald-600",
  edit: "bg-cobalt-50 text-cobalt-600",
  remove: "bg-red-50 text-red-600",
  relationship: "bg-rose-50 text-rose-600",
  tree: "bg-slate-100 text-slate-500",
}

function activityIcon(icon: ActivityIcon): ReactNode {
  return match(icon)
    .with("add", () => <UserPlus className="h-4 w-4" />)
    .with("edit", () => <Pencil className="h-4 w-4" />)
    .with("remove", () => <Trash2 className="h-4 w-4" />)
    .with("relationship", () => <Heart className="h-4 w-4" />)
    .with("tree", () => <Settings className="h-4 w-4" />)
    .exhaustive()
}

/** "Activity" section for the settings sidebar: a newest-first feed derived
 *  from the tree's change log. Names of people since removed fall back to
 *  "a person", and only the last ~30 days are kept by the change log. */
export function ActivitySection({
  family,
  treeId,
}: {
  family: FamilyStore
  treeId: string
}) {
  const resolveName = useMemo(
    () =>
      (personId: string): string | undefined => {
        const person = family.people[personId]
        if (!person) return undefined
        return person.familyName
          ? `${person.name} ${person.familyName}`
          : person.name
      },
    [family.people],
  )
  const { entries, loading } = useTreeActivity(treeId, resolveName)

  return (
    <details
      aria-labelledby="activity-heading"
      className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-slate-100 bg-slate-50/70 px-4 py-3 group-open:border-b [&::-webkit-details-marker]:hidden hover:bg-slate-100">
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-600">
            <History className="h-4 w-4" />
          </span>
          <h3
            id="activity-heading"
            className="text-sm font-semibold text-slate-800"
          >
            Activity
          </h3>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>

      {loading ? (
        <div
          className="space-y-2 px-4 py-3"
          aria-busy="true"
          aria-live="polite"
        >
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="flex items-center gap-2.5"
            >
              <div className="h-7 w-7 shrink-0 tree-skeleton animate-shimmer rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-2/3 tree-skeleton animate-shimmer rounded" />
                <div className="h-2.5 w-1/4 tree-skeleton animate-shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs leading-relaxed text-slate-500">
          No recent activity. Edits and additions from the last 30 days appear
          here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <li
              key={entry.version}
              className="flex items-start gap-2.5 px-4 py-2.5"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ICON_TONE[entry.icon]}`}
              >
                {activityIcon(entry.icon)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-slate-700">
                  {entry.text}
                </p>
                <p className="text-[11px] text-slate-400">
                  {[
                    entry.authorName ? `by ${entry.authorName}` : null,
                    formatRelativeTime(entry.createdAt),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
