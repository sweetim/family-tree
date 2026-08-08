import { Heart, HeartCrack } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import type { FamilyStore } from "@/store"
import { inputCls, labelCls, sidebarFormIds } from "./shared"

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
  const status = personA?.unionStatus?.[b]
  const date = status?.marriageDate ?? ""
  const isDivorced = status?.type === "divorced"
  const [divorceDate, setDivorceDate] = useState(status?.date ?? "")

  // Reset the local divorce date once the couple is reconciled so a later
  // re-divorce starts from an empty date (the previous inline reset behavior).
  useEffect(() => {
    if (!isDivorced) setDivorceDate("")
  }, [isDivorced])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editable || isDivorced) return
    family.setDivorced(a, b, true, divorceDate)
  }

  return (
    <form
      id={sidebarFormIds.marriage}
      onSubmit={handleSubmit}
      className="animate-slide-up space-y-4"
    >
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
            align="end"
          />
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isDivorced ? "bg-rose-50 text-rose-500" : "bg-red-50 text-red-500"
            }`}
            role="img"
            aria-label={isDivorced ? "Divorced" : "Married"}
          >
            {isDivorced ? (
              <HeartCrack className="h-5 w-5" />
            ) : (
              <Heart className="h-5 w-5" />
            )}
          </div>
          <PersonSummary name={nameB} />
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Heart className="h-4 w-4 text-red-500" />
          Married
        </span>
        <div>
          <label
            className={labelCls}
            htmlFor="marriage-date"
          >
            Date
          </label>
          <input
            id="marriage-date"
            type="date"
            disabled={!editable}
            value={date}
            onChange={(event) =>
              family.updateSpouseDate(a, b, event.target.value)
            }
            className={`${inputCls} disabled:opacity-60`}
          />
        </div>
      </div>

      {isDivorced && (
        <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-800">
            <HeartCrack className="h-4 w-4" />
            Divorced
          </span>
          <div>
            <label
              className={labelCls}
              htmlFor="divorce-date"
            >
              Date
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
      )}
    </form>
  )
}

function PersonSummary({ name, align }: { name: string; align?: "end" }) {
  return (
    <span
      className={`min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 ${
        align ? "text-right" : "text-left"
      }`}
    >
      {name}
    </span>
  )
}
