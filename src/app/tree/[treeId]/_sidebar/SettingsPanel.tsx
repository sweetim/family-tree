import {
  CalendarDays,
  Download,
  GitBranch,
  Heart,
  Layers,
  Map as MapIcon,
  Printer,
  Trees,
  Upload,
  User,
} from "lucide-react"
import { type ReactNode, useRef } from "react"
import { useToast } from "@/components/Toast"
import { useTreeActions } from "@/lib/tree-actions"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
import { useViewSettings } from "@/lib/view-settings"
import { type FamilyStore, isStoredPhotoMarker, normalizeImport } from "@/store"

function SettingToggle({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-slate-200">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-700">
          {title}
        </span>
        <span className="block text-xs leading-relaxed text-slate-500">
          {description}
        </span>
      </span>
      <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-cobalt-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt-300" />
        <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

export function SettingsPanel({
  family,
  treeId,
  editable,
  onClose,
}: {
  family: FamilyStore
  treeId: string
  editable: boolean
  onClose: () => void
}) {
  const { settings, update } = useViewSettings()
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const { getEditingSession } = useTreeEditMode()
  const { exportPdf } = useTreeActions()

  function exportJson() {
    const people = Object.fromEntries(
      Object.entries(family.people).map(([id, person]) => [
        id,
        isStoredPhotoMarker(person.photo)
          ? { ...person, photo: undefined }
          : person,
      ]),
    )
    const blob = new Blob([JSON.stringify(people, null, 2)], {
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
    const editingSession = getEditingSession(treeId)
    if (editingSession === null) return
    try {
      const contents = await file.text()
      if (getEditingSession(treeId) !== editingSession) return
      const data = normalizeImport(JSON.parse(contents))
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
      if (getEditingSession(treeId) !== editingSession) return
      console.error(err)
      toast("That file doesn't look like an exported family tree.", "error")
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold text-slate-800">Display</h2>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <SettingToggle
          icon={<MapIcon className="h-4 w-4" />}
          title="Minimap"
          description="Show the canvas overview (desktop only)"
          checked={settings.minimap}
          onChange={(checked) => update({ minimap: checked })}
        />
        <SettingToggle
          icon={<Heart className="h-4 w-4" />}
          title="Marriage years"
          description="Show each marriage's year on the canvas. Hover a union dot for the full date."
          checked={settings.marriageYears}
          onChange={(checked) => update({ marriageYears: checked })}
        />
        <SettingToggle
          icon={<CalendarDays className="h-4 w-4" />}
          title="Age"
          description="Show each living person's age on their card."
          checked={settings.showAge}
          onChange={(checked) => update({ showAge: checked })}
        />
        <SettingToggle
          icon={<User className="h-4 w-4" />}
          title="Family name"
          description="Show each person's family name before their name on their card."
          checked={settings.showFamilyName}
          onChange={(checked) => update({ showFamilyName: checked })}
        />
        <SettingToggle
          icon={<Layers className="h-4 w-4" />}
          title="Show all families"
          description="Render this family and all related families on this canvas. Off: show only this family."
          checked={settings.showAllFamilies}
          onChange={(checked) => update({ showAllFamilies: checked })}
        />
        <SettingToggle
          icon={<GitBranch className="h-4 w-4" />}
          title="Highlight bloodline"
          description="Outline the founding roots and their descendants, and dim married-in spouses so the bloodline stands out."
          checked={settings.highlightBloodline}
          onChange={(checked) => update({ highlightBloodline: checked })}
        />
        <SettingToggle
          icon={<Trees className="h-4 w-4" />}
          title="Other family trees"
          description="Show a badge on each person card for every other tree they belong to."
          checked={settings.showOtherTrees}
          onChange={(checked) => update({ showOtherTrees: checked })}
        />
      </div>

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
            title={editable ? undefined : "Switch to Edit mode to import"}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Import
          </button>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Export an offline copy as JSON, or import a previously exported tree.
          {!editable && " Import is only available while editing."}
        </p>
        <button
          type="button"
          onClick={exportPdf}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-soft ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
        >
          <Printer className="h-4 w-4" /> Export to PDF
        </button>
        <p className="text-xs leading-relaxed text-slate-500">
          Print the whole tree to a single landscape page — choose “Save as PDF”
          in the dialog.
        </p>
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
