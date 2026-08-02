import { CalendarDays, Heart, HeartCrack } from "lucide-react"
import { useState } from "react"
import type { FamilyStore } from "@/store"
import { GenderIcon } from "./GenderIcon"
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
}: {
  family: FamilyStore
  a: string
  b: string
  editable: boolean
}) {
  const personA = family.people[a]
  const personB = family.people[b]
  const nameA = personA?.name ?? "Unknown person"
  const nameB = personB?.name ?? "Unknown person"
  const date = personA?.marriageDates[b] ?? ""
  const status = personA?.unionStatus?.[b]
  const isDivorced = status?.type === "divorced"
  const [divorceDate, setDivorceDate] = useState(status?.date ?? "")

  return (
    <div className="animate-slide-up space-y-4">
      <div>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">
            Marriage
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Record this couple&apos;s relationship details.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <PersonSummary
            name={nameA}
            gender={personA?.gender}
            align="end"
          />
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isDivorced
                ? "bg-rose-50 text-rose-500"
                : "bg-cobalt-50 text-cobalt-600"
            }`}
            aria-label={isDivorced ? "Divorced" : "Married"}
          >
            {isDivorced ? (
              <HeartCrack className="h-5 w-5" />
            ) : (
              <Heart className="h-5 w-5" />
            )}
          </div>
          <PersonSummary
            name={nameB}
            gender={personB?.gender}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          Marriage details
        </div>
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
          onChange={(event) => family.updateSpouseDate(a, b, event.target.value)}
          className={`${inputCls} disabled:opacity-60`}
        />
      </div>

      {isDivorced ? (
        <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-800">
              <HeartCrack className="h-4 w-4" />
              Divorced
            </span>
            <button
              type="button"
              disabled={!editable}
              onClick={() => {
                family.setDivorced(a, b, false)
                setDivorceDate("")
              }}
              className="text-sm font-semibold text-cobalt-600 transition-colors hover:text-cobalt-700 disabled:opacity-50"
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
              onChange={(event) => {
                setDivorceDate(event.target.value)
                family.setDivorced(a, b, true, event.target.value)
              }}
              className={`${inputCls} border-rose-200 bg-white disabled:opacity-60`}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
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
              onChange={(event) => setDivorceDate(event.target.value)}
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

function PersonSummary({
  name,
  gender,
  align,
}: {
  name: string
  gender?: "male" | "female" | "other"
  align?: "end"
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"

  return (
    <div className={`min-w-0 flex-1 ${align ? "text-right" : "text-left"}`}>
      <div
        className={`flex items-center gap-2 ${
          align ? "justify-end" : "justify-start"
        }`}
      >
        {align && <PersonAvatar initials={initials} />}
        <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
          {name}
        </span>
        {!align && <PersonAvatar initials={initials} />}
      </div>
      {gender && (
        <span
          className={`mt-1 inline-flex items-center gap-1 text-xs capitalize text-slate-400 ${
            align ? "justify-end" : "justify-start"
          }`}
        >
          <GenderIcon gender={gender} />
          {gender}
        </span>
      )}
    </div>
  )
}

function PersonAvatar({ initials }: { initials: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
      {initials}
    </span>
  )
}
