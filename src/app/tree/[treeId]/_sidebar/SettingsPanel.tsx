import {
  CalendarDays,
  ChevronDown,
  Database,
  Download,
  EyeOff,
  FileDown,
  Focus,
  GitBranch,
  Hash,
  Heart,
  Layers,
  ListOrdered,
  Map as MapIcon,
  Printer,
  SlidersHorizontal,
  Sparkles,
  Trees,
  Upload,
  User,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Modal } from "@/components/Modal"
import { PersonAvatar } from "@/components/PersonAvatar"
import { useToast } from "@/components/Toast"
import { familyToGedcom } from "@/lib/gedcom"
import { personPhotoSrc } from "@/lib/image"
import { useTreeActions } from "@/lib/tree-actions"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
import { useViewSettings } from "@/lib/view-settings"
import { type FamilyStore, isStoredPhotoMarker, normalizeImport } from "@/store"

/** Lowercase, kebab-case form of a tree name for use in a download filename,
 *  falling back to "family-tree" when the name has no usable characters. */
function kebabName(name: string): string {
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return kebab || "family-tree"
}

/** Local date-and-time stamp, kebab-joined as YYYY-MM-DD-HH-MM-SS. */
function fileStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-")
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

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

function SettingNumber({
  icon,
  title,
  description,
  value,
  onChange,
}: {
  icon: ReactNode
  title: string
  description: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
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
      <input
        type="number"
        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm text-slate-700 focus:border-cobalt-400 focus:outline-none focus:ring-2 focus:ring-cobalt-200"
        value={value}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10)
          onChange(Number.isNaN(parsed) ? 0 : parsed)
        }}
      />
    </div>
  )
}

function DataAction({
  icon,
  title,
  description,
  onClick,
  disabled,
  disabledTitle,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
  disabledTitle?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
    >
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
    </button>
  )
}

export function SettingsPanel({
  family,
  treeId,
  treeName,
  editable,
  onClose,
}: {
  family: FamilyStore
  treeId: string
  treeName: string
  editable: boolean
  onClose: () => void
}) {
  const { settings, update } = useViewSettings()
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const { getEditingSession } = useTreeEditMode()
  const { exportPdf } = useTreeActions()
  const [generatingPhoto, setGeneratingPhoto] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [selectingPhoto, setSelectingPhoto] = useState(false)
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(
    new Set(),
  )
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
    a.download = `${kebabName(treeName)}-${fileStamp(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportGedcom() {
    const blob = new Blob([familyToGedcom(family.people)], {
      type: "text/plain;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${kebabName(treeName)}-${fileStamp(new Date())}.ged`
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

  function openPhotoPicker() {
    setSelectedPersonIds(new Set(Object.keys(family.people)))
    setSelectingPhoto(true)
  }

  function toggleSelectedPerson(id: string) {
    setSelectedPersonIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startGenerationFromPicker() {
    const personIds = [...selectedPersonIds]
    setSelectingPhoto(false)
    void generateFamilyPhoto(personIds)
  }

  async function generateFamilyPhoto(personIds: string[]) {
    if (generatingPhoto) return
    if (personIds.length === 0) {
      toast("Select at least one family member.", "error")
      return
    }
    setGeneratingPhoto(true)
    try {
      const start = await fetch(`/api/trees/${treeId}/family-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds }),
      })
      if (!start.ok) {
        const data = (await start.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          data?.error ?? "Could not start generating the family photo.",
        )
      }
      const { id } = (await start.json()) as { id: string }
      await pollFamilyPhoto(id)
    } catch (err) {
      toast(
        err instanceof Error
          ? err.message
          : "Could not generate the family photo.",
        "error",
      )
    } finally {
      setGeneratingPhoto(false)
    }
  }

  async function pollFamilyPhoto(jobId: string) {
    const pollIntervalMilliseconds = 3000
    const maxAttempts = 60
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!mountedRef.current) return
      const response = await fetch(`/api/trees/${treeId}/family-photo/${jobId}`)
      if (response.status === 202) {
        await delay(pollIntervalMilliseconds)
        continue
      }
      if (response.ok) {
        const blob = await response.blob()
        if (!mountedRef.current) return
        setPhotoPreviewUrl(URL.createObjectURL(blob))
        return
      }
      const data = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(data?.error ?? "Image generation failed.")
    }
    throw new Error("Image generation timed out. Please try again.")
  }

  function closePhotoPreview() {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    setPhotoPreviewUrl(null)
  }

  function downloadPhotoPreview() {
    if (!photoPreviewUrl) return
    const anchor = document.createElement("a")
    anchor.href = photoPreviewUrl
    anchor.download = "family-photo.png"
    anchor.click()
  }

  return (
    <div className="space-y-3">
      <details
        open
        aria-labelledby="canvas-appearance-heading"
        className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-slate-100 bg-slate-50/70 px-4 py-3 group-open:border-b [&::-webkit-details-marker]:hidden hover:bg-slate-100">
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-600">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <h3
              id="canvas-appearance-heading"
              className="text-sm font-semibold text-slate-800"
            >
              Appearance
            </h3>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div>
          <div className="divide-y divide-slate-100">
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
              icon={<Layers className="h-4 w-4" />}
              title="Show all families"
              description="Render this family and all related families on this canvas. Off: show only this family."
              checked={settings.showAllFamilies}
              onChange={(checked) => update({ showAllFamilies: checked })}
            />
            <SettingToggle
              icon={<ListOrdered className="h-4 w-4" />}
              title="Generation labels"
              description="Show a Gen N label on the left margin of each generation row, numbered from the top down."
              checked={settings.showGenerations}
              onChange={(checked) => update({ showGenerations: checked })}
            />
            {settings.showGenerations && (
              <div className="border-t border-slate-100 bg-slate-50/50 pl-5">
                <SettingNumber
                  icon={<Hash className="h-4 w-4" />}
                  title="Generation offset"
                  description="Number of the top generation row."
                  value={settings.generationOffset}
                  onChange={(value) => update({ generationOffset: value })}
                />
              </div>
            )}
            <SettingToggle
              icon={<GitBranch className="h-4 w-4" />}
              title="Highlight bloodline"
              description="Red marks the male line. Amber marks other descendants. Married-in spouses are muted."
              checked={settings.highlightBloodline}
              onChange={(checked) =>
                update({
                  highlightBloodline: checked,
                  hideNonDescendants: checked
                    ? settings.hideNonDescendants
                    : false,
                  hideAmberBloodline: checked
                    ? settings.hideAmberBloodline
                    : false,
                })
              }
            />
            {settings.highlightBloodline && (
              <div className="border-t border-slate-100 bg-amber-50/40 pl-5">
                <SettingToggle
                  icon={<EyeOff className="h-4 w-4" />}
                  title="Hide non-descendants"
                  description="Remove married-in spouses from the tree."
                  checked={settings.hideNonDescendants}
                  onChange={(checked) =>
                    update({ hideNonDescendants: checked })
                  }
                />
                <SettingToggle
                  icon={<EyeOff className="h-4 w-4" />}
                  title="Hide female descendants"
                  description="Show only the direct male bloodline in the tree."
                  checked={settings.hideAmberBloodline}
                  onChange={(checked) =>
                    update({ hideAmberBloodline: checked })
                  }
                />
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="divide-y divide-slate-100">
            <SettingToggle
              icon={<CalendarDays className="h-4 w-4" />}
              title="Age"
              description="Show each living person's age on their card."
              checked={settings.showAge}
              onChange={(checked) => update({ showAge: checked })}
            />
            <SettingToggle
              icon={<Focus className="h-4 w-4" />}
              title="Focus selected person"
              description="Center the selected person's card in view mode."
              checked={settings.focusSelectedPerson}
              onChange={(checked) =>
                update({ focusSelectedPerson: checked })
              }
            />
            <SettingToggle
              icon={<User className="h-4 w-4" />}
              title="Family name"
              description="Show each person's family name before their name on their card."
              checked={settings.showFamilyName}
              onChange={(checked) => update({ showFamilyName: checked })}
            />
            <SettingToggle
              icon={<Trees className="h-4 w-4" />}
              title="Other family trees"
              description="Show a badge on each person card for every other tree they belong to."
              checked={settings.showOtherTrees}
              onChange={(checked) => update({ showOtherTrees: checked })}
            />
          </div>
        </div>
      </details>

      <details
        aria-labelledby="import-export-heading"
        className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-slate-100 bg-slate-50/70 px-4 py-3 group-open:border-b [&::-webkit-details-marker]:hidden hover:bg-slate-100">
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-600">
              <Database className="h-4 w-4" />
            </span>
            <h3
              id="import-export-heading"
              className="text-sm font-semibold text-slate-800"
            >
              Data
            </h3>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-slate-100">
          <DataAction
            icon={<Download className="h-4 w-4" />}
            title="Export JSON"
            description="Save an offline copy of this tree as JSON."
            onClick={exportJson}
          />
          <DataAction
            icon={<Upload className="h-4 w-4" />}
            title="Import JSON"
            description="Replace this tree from a previously exported file."
            onClick={() => importRef.current?.click()}
            disabled={!editable}
            disabledTitle="Switch to Edit mode to import"
          />
          <DataAction
            icon={<FileDown className="h-4 w-4" />}
            title="Export GEDCOM"
            description="Download a .ged file for other genealogy apps."
            onClick={exportGedcom}
          />
          <DataAction
            icon={<Printer className="h-4 w-4" />}
            title="Export PDF"
            description="Print the whole tree to one landscape page."
            onClick={exportPdf}
          />
        </div>
      </details>

      <details
        aria-labelledby="family-photo-heading"
        className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-slate-100 bg-slate-50/70 px-4 py-3 group-open:border-b [&::-webkit-details-marker]:hidden hover:bg-slate-100">
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-600">
              <Sparkles className="h-4 w-4" />
            </span>
            <h3
              id="family-photo-heading"
              className="text-sm font-semibold text-slate-800"
            >
              Family photo
            </h3>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-slate-100">
          <DataAction
            icon={<Sparkles className="h-4 w-4" />}
            title="Generate family photo"
            description="Choose members, then combine their photos into one AI-generated, multi-generational portrait."
            onClick={openPhotoPicker}
            disabled={generatingPhoto}
            disabledTitle={generatingPhoto ? "Generating…" : undefined}
          />
        </div>
        {generatingPhoto && (
          <p className="px-4 pb-3 text-xs leading-relaxed text-slate-500">
            Generating… This uses the selected members' photos and
            relationships, and can take a minute or two.
          </p>
        )}
      </details>

      {selectingPhoto && (
        <Modal
          onClose={() => setSelectingPhoto(false)}
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  Choose family members
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedPersonIds.size} of{" "}
                  {Object.keys(family.people).length} selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectingPhoto(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto py-1">
              {Object.values(family.people)
                .sort((a, b) =>
                  `${a.familyName} ${a.name}`.localeCompare(
                    `${b.familyName} ${b.name}`,
                  ),
                )
                .map((person) => {
                  const photoSrc = personPhotoSrc(person)
                  const checked = selectedPersonIds.has(person.id)
                  return (
                    <label
                      key={person.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedPerson(person.id)}
                        className="h-4 w-4 rounded border-slate-300 text-cobalt-600 focus:ring-cobalt-300"
                      />
                      {photoSrc ? (
                        <PersonAvatar
                          src={photoSrc}
                          alt={person.name}
                          className="h-8 w-8 bg-slate-100"
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                          {(person.name[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-700">
                          {person.familyName
                            ? `${person.name} ${person.familyName}`
                            : person.name}
                        </span>
                        {!person.photo && (
                          <span className="block text-xs text-slate-400">
                            No photo
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectingPhoto(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startGenerationFromPicker}
                disabled={selectedPersonIds.size === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cobalt-500 disabled:pointer-events-none disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                Generate
              </button>
            </div>
          </div>
        </Modal>
      )}

      {photoPreviewUrl && (
        <Modal
          onClose={closePhotoPreview}
          backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 sm:p-8"
          portal
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">
                Family photo
              </h3>
              <button
                type="button"
                onClick={closePhotoPreview}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-auto bg-slate-100 p-6">
              {/* biome-ignore lint/performance/noImgElement: generated preview, no Next image pipeline */}
              <img
                src={photoPreviewUrl}
                alt="Generated family portrait"
                className="mx-auto max-h-[80vh] w-auto rounded-xl shadow-md"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closePhotoPreview}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={downloadPhotoPreview}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cobalt-500"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>
        </Modal>
      )}

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
  )
}
