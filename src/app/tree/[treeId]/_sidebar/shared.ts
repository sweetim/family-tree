import type { LinkKind } from "@/lib/tree-actions"
import type { Gender, Person, PersonInput, Relationship } from "@/types"

export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-200"
export const labelCls =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
export const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
export const ghostBtn =
  "rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
export const chip =
  "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs text-slate-700"
export const chipX =
  "flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-100 hover:text-red-600"
export const selectCls = `${inputCls} pr-9 select-chevron`

export type SidebarState =
  | { mode: "idle" }
  | { mode: "add"; rel: Relationship }
  | {
      mode: "choose"
      kind: LinkKind
      sourceId: string
      rel: Relationship
      /** When set, the chooser offers "Create new family" (for a married-in
       *  person's parents) instead of the usual "Add new". */
      createFamily?: boolean
      /** When set, the chooser additionally offers "Create new family"
       *  alongside "Add new" — used for root founders (the top of a bloodline
       *  with no parents in this tree), who may extend upward either way. */
      alsoCreateFamily?: boolean
    }
  | { mode: "edit"; personId: string }
  | { mode: "marriage"; a: string; b: string }
  | { mode: "linkParent"; personId: string }
  | { mode: "linkSpouse"; personId: string }
  | { mode: "linkChild"; personId: string }
  | { mode: "createFamily"; personId: string }
  | { mode: "settings" }
  | { mode: "share" }
  | { mode: "reviewChanges" }

export type Fields = {
  name: string
  gender: Gender | ""
  dob: string
  dod: string
  birthplace: string
  photo?: string
}

export function fieldsFrom(p?: Person): Fields {
  return {
    name: p?.name ?? "",
    gender: p?.gender ?? "",
    dob: p?.dob ?? "",
    dod: p?.dod ?? "",
    birthplace: p?.birthplace ?? "",
    photo: p?.photo,
  }
}

export function toInput(f: Fields): PersonInput {
  return {
    name: f.name.trim(),
    gender: f.gender || undefined,
    dob: f.dob || undefined,
    dod: f.dod || undefined,
    birthplace: f.birthplace.trim() || undefined,
    photo: f.photo,
  }
}

/** Reconstruct the chooser target (kind + source person) from an add relationship. Returns null for unconnected "root" adds, which have no chooser. */
export function chooseFromRel(
  rel: Relationship,
): { kind: LinkKind; sourceId: string } | null {
  if (rel.kind === "parent") return { kind: "parent", sourceId: rel.childId }
  if (rel.kind === "spouse") return { kind: "spouse", sourceId: rel.partnerId }
  if (rel.kind === "child") return { kind: "child", sourceId: rel.parentId }
  return null
}

/** Reconstruct the add relationship a chooser was opened with, from a link kind and the source person. */
export function relFromLink(kind: LinkKind, personId: string): Relationship {
  if (kind === "parent")
    return { kind: "parent", childId: personId, marryExisting: true }
  if (kind === "spouse") return { kind: "spouse", partnerId: personId }
  return { kind: "child", parentId: personId }
}
