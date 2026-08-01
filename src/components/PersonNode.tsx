import { Handle, type NodeProps, Position } from "@xyflow/react"
import { ArrowLeftRight, MapPin, Network, Plus } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { memo, useEffect, useState } from "react"
import { personPhotoSrc } from "../lib/image"
import { COUPLE_LINE_Y, type PersonNodeType } from "../lib/layout"
import { useTreeActions } from "../lib/tree-actions"
import { useViewSettings } from "../lib/view-settings"
import { useAncestorTree, useMemberTrees } from "../store"
import type { Gender } from "../types"
import { PersonAvatar } from "./PersonAvatar"

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
    .map((w) => w[0]?.toUpperCase() ?? "")
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
  "nodrag nopan pointer-events-auto z-10 flex h-9 w-9 items-center justify-center rounded-full bg-cobalt-600 text-base font-bold leading-none text-white shadow-soft transition-all duration-150 hover:bg-cobalt-500 opacity-100 scale-100 md:opacity-0 md:scale-50 md:pointer-events-none md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-hover:scale-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100 md:group-focus-within:scale-100"

const CARD_BORDER: Record<string, string> = {
  source: "border-cobalt-500 ring-2 ring-cobalt-300",
  eligible: "border-emerald-400 ring-2 ring-emerald-300",
  blocked: "border-slate-200 opacity-30",
  selected: "border-cobalt-500 ring-2 ring-cobalt-300 shadow-lift",
  bloodline: "border-amber-300 ring-2 ring-amber-200",
  default: "border-slate-200",
}

function PersonNodeBase({ data, selected }: NodeProps<PersonNodeType>) {
  const { person, linkState, marriedIn, rootFounder } = data
  const { openChoose, readOnly } = useTreeActions()
  const { settings } = useViewSettings()
  const router = useRouter()
  const navigate = (to: string) => router.push(to)
  const { treeId } = useParams<{ treeId: string }>()
  const otherTrees = useMemberTrees(person.id).filter((t) => t.id !== treeId)
  const ancestorTree = useAncestorTree(person.id, treeId)
  const showsAncestorBadge = !!ancestorTree && person.parents.length === 0
  const deceased = !!person.dod
  const age = person.dob ? ageOf(person.dob, person.dod) : null
  const genderKey = person.gender ?? "unknown"
  const avatarRing = AVATAR_RING[genderKey]
  const avatarFill = AVATAR_FILL[genderKey]
  const photoSrc = personPhotoSrc(person)
  const [photoError, setPhotoError] = useState(false)
  useEffect(() => {
    setPhotoError(false)
  }, [photoSrc])
  const showPhoto = photoSrc !== undefined && !photoError
  // Bloodline highlight only affects the resting state — an active click-to-
  // connect session or the selected card keep their own styling.
  const highlightBloodline = settings.highlightBloodline && !linkState
  const cardKey =
    linkState
    ?? (selected
      ? "selected"
      : highlightBloodline && !marriedIn
        ? "bloodline"
        : "default")
  const dimmed = highlightBloodline && marriedIn && !selected

  let lifeline: string | null = null
  if (deceased && person.dod) {
    lifeline = `${person.dob ? yearOf(person.dob) : "?"} – ${yearOf(person.dod)} †`
  } else if (person.dob) {
    lifeline = `${yearOf(person.dob)}${age !== null ? ` · ${age} yrs` : ""}`
  }

  return (
    <div
      className={`group relative transition-transform duration-200 hover:-translate-y-0.5 ${dimmed ? "opacity-40" : ""}`}
    >
      <div
        className={`w-44 rounded-2xl border bg-white transition-all duration-200 ${
          CARD_BORDER[cardKey]
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
              {showPhoto && photoSrc ? (
                <PersonAvatar
                  src={photoSrc}
                  alt={person.name}
                  className="h-[104px] w-[104px]"
                  onError={() => setPhotoError(true)}
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
            {person.birthplace && (
              <p
                className="mt-0.5 inline-flex items-center gap-0.5 truncate text-xs text-slate-400"
                title={person.birthplace}
              >
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{person.birthplace}</span>
              </p>
            )}
            {settings.showOtherTrees && readOnly && !!otherTrees.length && (
              <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                {otherTrees.map((t) => (
                  <button
                    type="button"
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

      {showsAncestorBadge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <button
            type="button"
            title={`Ancestor family: ${ancestorTree.name}`}
            className="nodrag nopan relative z-10 inline-flex max-w-[170px] cursor-pointer items-center gap-1 rounded-full bg-cobalt-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-soft transition-colors hover:bg-cobalt-700 before:absolute before:inset-x-[-10px] before:inset-y-[-11px] before:content-['']"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/tree/${ancestorTree.id}/p/${person.id}`)
            }}
          >
            <Network className="h-3 w-3 shrink-0" />
            <span className="truncate">{ancestorTree.name}</span>
          </button>
        </div>
      )}

      {!linkState && !readOnly && (
        <>
          {person.parents.length < 2 && !showsAncestorBadge && (
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <button
                type="button"
                title="Add or connect parent"
                className={addBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  openChoose(
                    "parent",
                    person.id,
                    {
                      kind: "parent",
                      childId: person.id,
                      marryExisting: true,
                    },
                    { createFamily: marriedIn, alsoCreateFamily: rootFounder },
                  )
                }}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="absolute -right-3.5 top-1/2 -translate-y-1/2">
            <button
              type="button"
              title="Add or connect spouse"
              className={addBtn}
              onClick={(e) => {
                e.stopPropagation()
                openChoose("spouse", person.id, {
                  kind: "spouse",
                  partnerId: person.id,
                })
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2">
            <button
              type="button"
              title="Add or connect child"
              className={addBtn}
              onClick={(e) => {
                e.stopPropagation()
                openChoose("child", person.id, {
                  kind: "child",
                  parentId: person.id,
                })
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * React Flow rebuilds every node object when selection changes, so a shallow
 * prop check would re-render all cards on each click. Comparing only the
 * fields that affect this card's output keeps re-renders to the cards whose
 * `selected` actually toggled. Context/store hooks still bypass this, as
 * intended, for real data changes.
 */
export const PersonNode = memo(
  PersonNodeBase,
  (prev, next) =>
    prev.selected === next.selected
    && prev.data.person === next.data.person
    && prev.data.linkState === next.data.linkState
    && prev.data.marriedIn === next.data.marriedIn
    && prev.data.rootFounder === next.data.rootFounder,
)
