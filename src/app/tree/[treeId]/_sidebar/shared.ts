import type { Gender, Person, PersonInput, Relationship } from "@/types"

export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-200"
export const labelCls =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
export const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
export const ghostBtn =
  "rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"

export type SidebarState =
  | { mode: "idle" }
  | { mode: "add"; rel: Relationship }
  | { mode: "edit"; personId: string }
  | { mode: "settings" }

export type Fields = {
  name: string
  gender: Gender | ""
  dob: string
  dod: string
  location: string
  photo?: string
}

export function fieldsFrom(p?: Person): Fields {
  return {
    name: p?.name ?? "",
    gender: p?.gender ?? "",
    dob: p?.dob ?? "",
    dod: p?.dod ?? "",
    location: p?.location ?? "",
    photo: p?.photo,
  }
}

export function toInput(f: Fields): PersonInput {
  return {
    name: f.name.trim(),
    gender: f.gender || undefined,
    dob: f.dob || undefined,
    dod: f.dod || undefined,
    location: f.location.trim() || undefined,
    photo: f.photo,
  }
}
