import { useState } from "react"
import type { FamilyStore } from "@/store"
import { inputCls, labelCls, primaryBtn } from "./shared"

/**
 * Focused editor for a single couple's marriage. Opened by clicking a
 * union dot on the canvas — shows only the couple, their marriage date, and
 * a divorce toggle so a marriage can be recorded as ended without unlinking
 * the spouses (which would also drop their shared children's parent line).
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
  const personA = family.people[a]
  const date = personA?.marriageDates[b] ?? ""
  const status = personA?.unionStatus?.[b]
  const isDivorced = status?.type === "divorced"
  const [divorceDate, setDivorceDate] = useState(status?.date ?? "")

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

      {isDivorced ? (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
              Divorced
            </span>
            <button
              type="button"
              disabled={!editable}
              onClick={() => {
                family.setDivorced(a, b, false)
                setDivorceDate("")
              }}
              className="text-sm font-medium text-cobalt-600 transition-colors hover:text-cobalt-700 disabled:opacity-50"
            >
              Reconcile
            </button>
          </div>
          <div>
            <label
              className={labelCls}
              htmlFor="divorce-date"
            >
              Divorce date
            </label>
            <input
              id="divorce-date"
              type="date"
              disabled={!editable}
              value={divorceDate}
              onChange={(e) => {
                setDivorceDate(e.target.value)
                family.setDivorced(a, b, true, e.target.value)
              }}
              className={`${inputCls} disabled:opacity-60`}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label
              className={labelCls}
              htmlFor="divorce-date"
            >
              Divorce date (optional)
            </label>
            <input
              id="divorce-date"
              type="date"
              disabled={!editable}
              value={divorceDate}
              onChange={(e) => setDivorceDate(e.target.value)}
              className={`${inputCls} disabled:opacity-60`}
            />
          </div>
          <button
            type="button"
            disabled={!editable}
            onClick={() => family.setDivorced(a, b, true, divorceDate)}
            className={`${primaryBtn} w-full bg-rose-600 hover:bg-rose-700`}
          >
            Mark as divorced
          </button>
        </div>
      )}
    </div>
  )
}
