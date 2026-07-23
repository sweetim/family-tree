import { Download, Upload } from "lucide-react"
import { useRef } from "react"
import { useToast } from "@/components/Toast"
import { useViewSettings } from "@/lib/view-settings"
import { type FamilyStore, normalizeImport } from "@/store"

export function SettingsPanel({
  family,
  editable,
  onClose,
}: {
  family: FamilyStore
  editable: boolean
  onClose: () => void
}) {
  const { settings, update } = useViewSettings()
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  function exportJson() {
    const blob = new Blob([JSON.stringify(family.people, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "family-tree.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File | undefined) {
    if (!file) return
    try {
      const data = normalizeImport(JSON.parse(await file.text()))
      const valid = Object.values(data).every(
        (p) =>
          p
          && typeof p.id === "string"
          && typeof p.name === "string"
          && Array.isArray(p.parents),
      )
      if (!valid) throw new Error("Unrecognised format")
      family.replaceAll(data)
      onClose()
    } catch (err) {
      console.error(err)
      toast("That file doesn't look like an exported family tree.", "error")
    }
  }

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

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Data</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={exportJson}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={!editable}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Import
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            importJson(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}
