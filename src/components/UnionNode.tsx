import { Handle, Position } from "@xyflow/react"
import { useTreeActions } from "@/lib/tree-actions"
import { useViewSettings } from "@/lib/view-settings"

const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent"

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * Invisible-handle junction dot where a couple's line meets their children.
 *
 * - Hovering the dot shows the full marriage date (via the `title` tooltip).
 * - When the "Marriage years" view setting is on, the marriage's year is shown
 *   inside the dot itself — the 12px dot is overlaid with a larger circle
 *   badge carrying the year. The dot and its invisible handles stay put, so
 *   the marriage line still lands on the right spot.
 * - In edit mode, clicking the dot opens the couple's marriage editor via
 *   `TreeActions.editMarriage`.
 */
export function UnionNode({
  data,
}: {
  data: {
    date?: string
    a?: string
    b?: string
    statusType?: string
    divorceDate?: string
  }
}) {
  const { settings } = useViewSettings()
  const { editMarriage, readOnly } = useTreeActions()
  const iso = data.date
  const year = iso ? new Date(iso).getFullYear() : undefined
  const showYear = settings.marriageYears && iso && year && !Number.isNaN(year)
  const divorced = data.statusType === "divorced"
  const ringCls = divorced
    ? "border-rose-300 bg-rose-50"
    : "border-slate-300 bg-white"

  return (
    <button
      type="button"
      disabled={readOnly}
      className={`relative flex appearance-none items-center justify-center border-0 bg-transparent p-0 ${
        readOnly ? "cursor-default" : "cursor-pointer"
      }`}
      title={
        divorced
          ? data.divorceDate
            ? `Divorced ${formatDate(data.divorceDate)}`
            : "Divorced"
          : iso
            ? formatDate(iso)
            : undefined
      }
      onClick={() => {
        if (data.a && data.b) editMarriage(data.a, data.b)
      }}
    >
      <div className={`h-3 w-3 rounded-full border-2 shadow-soft ${ringCls}`}>
        <Handle
          id="l"
          type="target"
          position={Position.Left}
          className={hidden}
        />
        <Handle
          id="r"
          type="target"
          position={Position.Right}
          className={hidden}
        />
        <Handle
          id="b"
          type="source"
          position={Position.Bottom}
          className={hidden}
        />
      </div>
      {showYear && (
        <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-[9px] font-semibold text-slate-500 shadow-soft">
          {year}
        </div>
      )}
    </button>
  )
}
