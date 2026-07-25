import { Handle, Position } from "@xyflow/react"
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
 *   as a compact label just above the dot. The label sits in the inter-card
 *   gap, clear of the vertical child bus that drops below the dot.
 */
export function UnionNode({ data }: { data: { date?: string } }) {
  const { settings } = useViewSettings()
  const iso = data.date
  const year = iso ? new Date(iso).getFullYear() : undefined
  const showYear = settings.marriageYears && iso && year && !Number.isNaN(year)

  return (
    <div
      className="relative flex flex-col items-center"
      title={iso ? formatDate(iso) : undefined}
    >
      <div className="h-3 w-3 rounded-full border-2 border-slate-300 bg-white shadow-soft">
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
        <span className="absolute -top-4 whitespace-nowrap rounded-md bg-white/90 px-1 py-0.5 text-[10px] font-medium text-slate-500 shadow-soft ring-1 ring-slate-200">
          {year}
        </span>
      )}
    </div>
  )
}
