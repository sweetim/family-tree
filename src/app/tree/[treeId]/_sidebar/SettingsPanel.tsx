import { useViewSettings } from "@/lib/view-settings"

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, update } = useViewSettings()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Display</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-cobalt-600 transition-colors hover:text-cobalt-700"
        >
          Done
        </button>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
        <span>
          <span className="block text-sm font-medium text-slate-700">
            Minimap
          </span>
          <span className="block text-xs text-slate-500">
            Show the canvas overview (desktop only)
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.minimap}
          onChange={(e) => update({ minimap: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-cobalt-600 focus:ring-cobalt-500"
        />
      </label>
    </div>
  )
}
