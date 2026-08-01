import { useEffect, useMemo, useRef, useState } from "react"
import { selectCls } from "./shared"

type Parts = { year: string; month: string; day: string }

const MONTHS = [
  { value: "", label: "Month" },
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
]

const DAYS = [
  { value: "", label: "Day" },
  ...Array.from({ length: 31 }, (_, index) => {
    const value = String(index + 1)
    return { value, label: value }
  }),
]

const MIN_YEAR = 1800
const MAX_YEAR = new Date().getFullYear() + 1

/** Split a stored ISO date (full or partial) into editable parts. */
function parse(iso: string): Parts {
  if (!iso) return { year: "", month: "", day: "" }
  const match = iso.match(/^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/)
  if (!match) return { year: "", month: "", day: "" }
  return {
    year: match[1] ?? "",
    month: match[2] ?? "",
    day: match[3] ? String(Number(match[3])) : "",
  }
}

/**
 * Combine the parts into the most precise valid ISO date and an optional error.
 * Year is required to store anything; day/month without a year are ignored.
 * Day is validated against the month/year and dropped (with an error) if invalid.
 */
function compose({ year, month, day }: Parts): {
  value: string
  error?: string
} {
  if (year === "") return { value: "" }
  if (month === "") return { value: year }
  if (day === "") return { value: `${year}-${month}` }
  const dayNum = Number(day)
  const probe = new Date(Number(year), Number(month) - 1, dayNum)
  if (probe.getDate() !== dayNum) {
    return {
      value: `${year}-${month}`,
      error: "Day is out of range for this month",
    }
  }
  return { value: `${year}-${month}-${String(dayNum).padStart(2, "0")}` }
}

/**
 * Birth/death date as three dropdowns (Day / Month / Year). Each part is
 * optional, so older records with a missing day or month can still be entered.
 * Stored as an ISO partial: "yyyy", "yyyy-mm", or full "yyyy-mm-dd".
 */
export function DateField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const [parts, setParts] = useState<Parts>(() => parse(value))
  const [error, setError] = useState<string>()
  const emittedRef = useRef(value)

  // Resync local state only when the value changes from outside (e.g. switching
  // to another person), not from our own onChange.
  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setError(undefined)
    setParts(parse(value))
  }, [value])

  // Descending year range; always include the stored year even if out of range.
  const years = useMemo(() => {
    const list: string[] = []
    for (let year = MAX_YEAR; year >= MIN_YEAR; year--) list.push(String(year))
    if (/^\d+$/.test(parts.year)) {
      const yearNum = Number(parts.year)
      if (yearNum > MAX_YEAR || yearNum < MIN_YEAR) list.push(parts.year)
    }
    return list
  }, [parts.year])

  function update(next: Parts) {
    setParts(next)
    const { value: composed, error: nextError } = compose(next)
    setError(nextError)
    emittedRef.current = composed
    onChange(composed)
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-2">
        <select
          id={id}
          aria-label="Day"
          value={parts.day}
          onChange={(e) => update({ ...parts, day: e.target.value })}
          className={selectCls}
        >
          {DAYS.map((d) => (
            <option
              key={d.value}
              value={d.value}
            >
              {d.label}
            </option>
          ))}
        </select>
        <select
          id={`${id}-month`}
          aria-label="Month"
          value={parts.month}
          onChange={(e) => update({ ...parts, month: e.target.value })}
          className={selectCls}
        >
          {MONTHS.map((m) => (
            <option
              key={m.value}
              value={m.value}
            >
              {m.label}
            </option>
          ))}
        </select>
        <select
          id={`${id}-year`}
          aria-label="Year"
          value={parts.year}
          onChange={(e) => update({ ...parts, year: e.target.value })}
          className={selectCls}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option
              key={y}
              value={y}
            >
              {y}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
