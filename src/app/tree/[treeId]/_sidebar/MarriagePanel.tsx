import type { FamilyStore } from "@/store"
import { inputCls, labelCls } from "./shared"

/**
 * Focused editor for a single couple's marriage date. Opened by clicking a
 * union dot on the canvas — shows only the couple and their date, nothing
 * else, to match the intent of that click.
 */
export function MarriagePanel({
  family,
  a,
  b,
  editable,
  onClose,
}: {
  family: FamilyStore
  a: string
  b: string
  editable: boolean
  onClose: () => void
}) {
  const nameA = family.people[a]?.name ?? "—"
  const nameB = family.people[b]?.name ?? "—"
  const date = family.people[a]?.marriageDates[b] ?? ""

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Marriage</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-cobalt-600 transition-colors hover:text-cobalt-700"
        >
          Done
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-medium text-slate-700">
        {nameA} &amp; {nameB}
      </div>

      <div>
        <label
          className={labelCls}
          htmlFor="marriage-date"
        >
          Marriage date
        </label>
        <input
          id="marriage-date"
          type="date"
          disabled={!editable}
          value={date}
          onChange={(e) => family.updateSpouseDate(a, b, e.target.value)}
          className={`${inputCls} disabled:opacity-60`}
        />
      </div>
    </div>
  )
}
