import { ChevronLeft, Download, Plus, Upload, Users } from "lucide-react"
import Link from "next/link"
import { useRef } from "react"
import { AccountMenu } from "@/components/AccountMenu"
import { useToast } from "@/components/Toast"
import { type FamilyStore, normalizeImport, type TreeMeta } from "@/store"
import { AddForm } from "./AddForm"
import { EditForm } from "./EditForm"
import { ReadonlyDetails } from "./ReadonlyDetails"
import { primaryBtn, type SidebarState } from "./shared"

export type { SidebarState }

interface Props {
  family: FamilyStore
  treeId: string
  treeName: string
  allTrees: TreeMeta[]
  state: SidebarState
  open: boolean
  editable: boolean
  onSelect: (id: string) => void
  onAddRoot: () => void
  onFocus: (id: string) => void
  onClose: () => void
}

export function Sidebar({
  family,
  treeId,
  treeName,
  allTrees,
  state,
  open,
  editable,
  onSelect,
  onAddRoot,
  onFocus,
  onClose,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const count = Object.keys(family.people).length
  const readOnly = family.readOnly

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

  const editingPerson =
    state.mode === "edit" ? family.people[state.personId] : undefined

  return (
    <aside
      className={`flex h-full w-[88vw] max-w-sm shrink-0 flex-col border-r border-slate-200 bg-white/95 backdrop-blur-sm transition-transform duration-200 fixed inset-y-0 left-0 z-40 md:static md:w-80 md:max-w-none md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-1.5">
          <Link
            href="/"
            title="All trees"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs font-medium text-slate-400">All trees</span>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
        <h1 className="mt-2 text-lg font-bold tracking-tight text-slate-800">
          {treeName}
        </h1>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-cobalt-50 px-2.5 py-1 text-xs font-medium text-cobalt-700">
          <Users className="h-3.5 w-3.5" />
          {count} members
        </span>
      </div>

      <div className="scroll-area flex-1 overflow-y-auto px-5 py-4">
        {state.mode === "add" && editable ? (
          <AddForm
            key={JSON.stringify(state.rel)}
            family={family}
            rel={state.rel}
            onDone={onClose}
            onClose={onClose}
          />
        ) : editingPerson && editable ? (
          <EditForm
            key={editingPerson.id}
            family={family}
            treeId={treeId}
            allTrees={allTrees}
            person={editingPerson}
            onSelect={onSelect}
            onFocus={onFocus}
            onClose={onClose}
          />
        ) : editingPerson ? (
          <ReadonlyDetails
            family={family}
            person={editingPerson}
            onSelect={onSelect}
          />
        ) : readOnly ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
            You have a <b>viewer</b> role on this tree — read-only. Ask the
            owner for editor access to add or edit people.
          </div>
        ) : editable ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
              <p className="text-sm leading-relaxed text-slate-500">
                Click a card to edit it, or hover a card and use the{" "}
                <b className="font-semibold text-slate-700">+</b> buttons to add
                a new parent, spouse or child — or the{" "}
                <b className="font-semibold text-slate-700">link</b> buttons to
                connect two people already in the tree by clicking their cards.
              </p>
            </div>
            <button
              type="button"
              onClick={onAddRoot}
              className={`${primaryBtn} w-full`}
            >
              <Plus className="h-4 w-4" /> Add unconnected member
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
            <p className="text-sm leading-relaxed text-slate-500">
              Tap a card to view its details. Tap{" "}
              <b className="font-semibold text-slate-700">Edit</b> to add or
              change people.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-5 py-4">
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
    </aside>
  )
}
