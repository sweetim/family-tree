import { Handle, Position } from "@xyflow/react"
import { memo } from "react"
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
 * - Clicking the dot opens the couple's marriage panel via
 *   `TreeActions.editMarriage`. In edit mode the dates are editable; in view
 *   mode the panel shows them read-only.
 */
function UnionNodeBase({
  data,
}: {
  data: {
    date?: string
    a?: string
    b?: string
    statusType?: string
    divorceDate?: string
    selected?: boolean
  }
}) {
  const { settings } = useViewSettings()
  const { editMarriage } = useTreeActions()
  const iso = data.date
  const year = iso ? new Date(iso).getFullYear() : undefined
  const showYear = settings.marriageYears && iso && year && !Number.isNaN(year)
  const divorced = data.statusType === "divorced"
  const selected = data.selected
  const ringCls = selected
    ? "border-cobalt-500 bg-white ring-2 ring-cobalt-300"
    : divorced
      ? "border-rose-300 bg-rose-50"
      : "border-slate-300 bg-white"

  return (
    <button
      type="button"
      className="relative flex appearance-none cursor-pointer items-center justify-center border-0 bg-transparent p-0"
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
        <div
          className={`absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white text-[9px] font-semibold shadow-soft ${
            selected
              ? "border-cobalt-500 text-cobalt-600 ring-2 ring-cobalt-300"
              : "border-slate-300 text-slate-500"
          }`}
        >
          {year}
        </div>
      )}
    </button>
  )
}

/**
 * Union nodes are rebuilt by `buildFlow` on every selection change; comparing
 * only the data fields that affect the dot avoids re-rendering them all on
 * each click.
 */
export const UnionNode = memo(
  UnionNodeBase,
  (prev, next) =>
    prev.data.date === next.data.date
    && prev.data.a === next.data.a
    && prev.data.b === next.data.b
    && prev.data.statusType === next.data.statusType
    && prev.data.divorceDate === next.data.divorceDate
    && prev.data.selected === next.data.selected,
)
