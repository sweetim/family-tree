import type { Person } from "@/types"

export function RelationList({
  people,
  onSelect,
  marriageDates,
}: {
  people: Person[]
  onSelect: (id: string) => void
  marriageDates?: Record<string, string>
}) {
  if (people.length === 0) return <p className="text-xs text-slate-400">None</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const iso = marriageDates?.[p.id]
        const year = iso && new Date(iso).getFullYear()
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-cobalt-50 hover:text-cobalt-700"
          >
            {p.name}
            {year && !Number.isNaN(year) && (
              <span className="ml-1 text-slate-400">· {year}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
