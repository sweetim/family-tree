import { Handle, type NodeProps, Position } from "@xyflow/react"
import { ArrowLeftRight, Link2, MapPin, Plus } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { COUPLE_LINE_Y, type PersonNodeType } from "../lib/layout"
import { useTreeActions } from "../lib/tree-actions"
import { useMemberTrees } from "../store"
import type { Gender } from "../types"

function ageOf(dob: string, until?: string): number | null {
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const end = until ? new Date(until) : new Date()
  let age = end.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    end.getMonth() < birth.getMonth()
    || (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
}

const AVATAR_RING: Record<Gender | "unknown", string> = {
  male: "from-sky-300 via-sky-400 to-cobalt-400",
  female: "from-rose-300 via-rose-400 to-pink-400",
  other: "from-violet-300 via-violet-400 to-fuchsia-400",
  unknown: "from-slate-200 via-slate-300 to-slate-400",
}
const AVATAR_FILL: Record<Gender | "unknown", string> = {
  male: "bg-sky-50 text-sky-600",
  female: "bg-rose-50 text-rose-600",
  other: "bg-violet-50 text-violet-600",
  unknown: "bg-slate-50 text-slate-500",
}

function yearOf(iso: string): string {
  const y = new Date(iso).getFullYear()
  return Number.isNaN(y) ? "?" : String(y)
}

const hiddenHandle = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent"
const addBtn =
  "nodrag nopan pointer-events-auto z-10 flex h-7 w-7 items-center justify-center rounded-full bg-cobalt-600 text-base font-bold leading-none text-white shadow-soft transition-all duration-150 hover:bg-cobalt-500 opacity-0 scale-50 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-hover:scale-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:scale-100"
const linkBtn =
  "nodrag nopan pointer-events-auto z-10 flex h-7 w-7 items-center justify-center rounded-full border border-cobalt-300 bg-white text-xs leading-none text-cobalt-600 shadow-soft transition-all duration-150 hover:bg-cobalt-50 opacity-0 scale-50 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-hover:scale-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:scale-100"

const CARD_BORDER: Record<string, string> = {
  source: "border-cobalt-500 ring-2 ring-cobalt-300",
  eligible: "border-emerald-400 ring-2 ring-emerald-300",
  blocked: "border-slate-200 opacity-30",
  selected: "border-cobalt-500 ring-2 ring-cobalt-300",
  default: "border-slate-200",
}

export function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  const { person, linkState } = data
  const { openAdd, startLink, readOnly } = useTreeActions()
  const router = useRouter()
  const navigate = (to: string) => router.push(to)
  const { treeId } = useParams<{ treeId: string }>()
  const otherTrees = useMemberTrees(person.id).filter((t) => t.id !== treeId)
  const deceased = !!person.dod
  const age = person.dob ? ageOf(person.dob, person.dod) : null
  const genderKey = person.gender ?? "unknown"
  const avatarRing = AVATAR_RING[genderKey]
  const avatarFill = AVATAR_FILL[genderKey]

  let lifeline: string | null = null
  if (deceased) {
    lifeline = `${person.dob ? yearOf(person.dob) : "?"} – ${yearOf(person.dod!)} †`
  } else if (person.dob) {
    lifeline = `${yearOf(person.dob)}${age !== null ? ` · ${age} yrs` : ""}`
  }

  return (
    <div className="group relative">
      <div
        className={`w-44 rounded-2xl border bg-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift ${
          CARD_BORDER[linkState ?? (selected ? "selected" : "default")]
        }`}
      >
        <Handle
          id="t"
          type="target"
          position={Position.Top}
          className={hiddenHandle}
        />
        <Handle
          id="l"
          type="source"
          position={Position.Left}
          className={hiddenHandle}
          style={{ top: COUPLE_LINE_Y }}
        />
        <Handle
          id="r"
          type="source"
          position={Position.Right}
          className={hiddenHandle}
          style={{ top: COUPLE_LINE_Y }}
        />
        <Handle
          id="b"
          type="source"
          position={Position.Bottom}
          className={hiddenHandle}
        />

        <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-4">
          <div className="relative">
            <div
              className={`rounded-full bg-linear-to-br p-[3px] ${avatarRing} ${deceased ? "grayscale" : ""}`}
            >
              {person.photo ? (
                <img
                  src={person.photo}
                  alt={person.name}
                  className="h-[104px] w-[104px] rounded-full object-cover"
                />
              ) : (
                <div
                  className={`flex h-[104px] w-[104px] items-center justify-center rounded-full text-3xl font-semibold ${avatarFill}`}
                >
                  {initials(person.name) || "?"}
                </div>
              )}
            </div>
          </div>

          <div className="w-full text-center">
            <p
              className="truncate font-semibold tracking-tight text-slate-800"
              title={person.name}
            >
              {person.name}
            </p>
            {lifeline && (
              <div className="mt-1 flex justify-center">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deceased ? "bg-slate-100 text-slate-600" : "bg-cobalt-50 text-cobalt-700"}`}
                >
                  {lifeline}
                </span>
              </div>
            )}
            {person.location && (
              <p
                className="mt-0.5 inline-flex items-center gap-0.5 truncate text-xs text-slate-400"
                title={person.location}
              >
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{person.location}</span>
              </p>
            )}
            {!!otherTrees.length && (
              <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                {otherTrees.map((t) => (
                  <button
                    key={t.id}
                    title={`Open in ${t.name}`}
                    className="nodrag nopan inline-flex max-w-full items-center gap-1 truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/tree/${t.id}/p/${person.id}`)
                    }}
                  >
                    <ArrowLeftRight className="h-3 w-3 shrink-0" /> {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {!linkState && !readOnly && (
        <>
          {person.parents.length < 2 && (
            <div className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
              <button
                title="Add new parent"
                className={addBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  openAdd({
                    kind: "parent",
                    childId: person.id,
                    marryExisting: true,
                  })
                }}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                title="Connect existing person as parent (their spouse joins too)"
                className={linkBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  startLink("parent", person.id)
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="absolute -right-3.5 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
            <button
              title="Add new spouse"
              className={addBtn}
              onClick={(e) => {
                e.stopPropagation()
                openAdd({ kind: "spouse", partnerId: person.id })
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              title="Connect existing person as spouse"
              className={linkBtn}
              onClick={(e) => {
                e.stopPropagation()
                startLink("spouse", person.id)
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
            <button
              title="Add new child"
              className={addBtn}
              onClick={(e) => {
                e.stopPropagation()
                openAdd({ kind: "child", parentId: person.id })
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              title="Connect existing person as child"
              className={linkBtn}
              onClick={(e) => {
                e.stopPropagation()
                startLink("child", person.id)
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
