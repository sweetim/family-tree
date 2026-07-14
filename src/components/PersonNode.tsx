import { Handle, Position, type NodeProps } from "@xyflow/react";
import { COUPLE_LINE_Y, type PersonNodeType } from "../lib/layout";
import { useTreeActions } from "../lib/tree-actions";
import type { Gender } from "../types";

function ageOf(dob: string, until?: string): number | null {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const end = until ? new Date(until) : new Date();
  let age = end.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    end.getMonth() < birth.getMonth() ||
    (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join("");
}

const AVATAR_COLORS: Record<Gender | "unknown", string> = {
  male: "bg-sky-100 text-sky-700",
  female: "bg-rose-100 text-rose-700",
  other: "bg-violet-100 text-violet-700",
  unknown: "bg-slate-100 text-slate-500",
};

function yearOf(iso: string): string {
  const y = new Date(iso).getFullYear();
  return Number.isNaN(y) ? "?" : String(y);
}

const hiddenHandle = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";
const addBtn =
  "nodrag nopan pointer-events-auto z-10 hidden h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-base font-bold leading-none text-white shadow-md transition-colors hover:bg-indigo-500 group-hover:flex";
const linkBtn =
  "nodrag nopan pointer-events-auto z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-indigo-300 bg-white text-xs leading-none text-indigo-600 shadow-md transition-colors hover:bg-indigo-50 group-hover:flex";

const CARD_BORDER: Record<string, string> = {
  source: "border-indigo-500 ring-2 ring-indigo-300",
  eligible: "border-emerald-400 ring-2 ring-emerald-300",
  blocked: "border-slate-200 opacity-30",
  selected: "border-indigo-500 ring-2 ring-indigo-300",
  default: "border-slate-200",
};

export function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  const { person, linkState } = data;
  const { openAdd, startLink } = useTreeActions();
  const deceased = !!person.dod;
  const age = person.dob ? ageOf(person.dob, person.dod) : null;

  let lifeline: string | null = null;
  if (deceased) {
    lifeline = `${person.dob ? yearOf(person.dob) : "?"} – ${yearOf(person.dod!)} †`;
  } else if (person.dob) {
    lifeline = `${yearOf(person.dob)}${age !== null ? ` · ${age} yrs` : ""}`;
  }

  return (
    <div className="group relative">
      <div
        className={`w-44 rounded-2xl border bg-white shadow-md transition-shadow hover:shadow-lg ${
          CARD_BORDER[linkState ?? (selected ? "selected" : "default")]
        } ${deceased && linkState !== "blocked" ? "opacity-80" : ""}`}
      >
        <Handle id="t" type="target" position={Position.Top} className={hiddenHandle} />
        <Handle id="l" type="source" position={Position.Left} className={hiddenHandle} style={{ top: COUPLE_LINE_Y }} />
        <Handle id="r" type="source" position={Position.Right} className={hiddenHandle} style={{ top: COUPLE_LINE_Y }} />
        <Handle id="b" type="source" position={Position.Bottom} className={hiddenHandle} />

        <div className="flex flex-col items-center gap-2 p-4">
          {person.photo ? (
            <img
              src={person.photo}
              alt={person.name}
              className={`h-24 w-24 rounded-full border-2 border-indigo-100 object-cover ${deceased ? "grayscale" : ""}`}
            />
          ) : (
            <div
              className={`flex h-24 w-24 items-center justify-center rounded-full text-2xl font-semibold ${
                AVATAR_COLORS[person.gender ?? "unknown"]
              }`}
            >
              {initials(person.name) || "?"}
            </div>
          )}

          <div className="w-full text-center">
            <p className="truncate font-semibold text-slate-800" title={person.name}>
              {person.name}
            </p>
            {lifeline && <p className="text-xs text-slate-500">{lifeline}</p>}
            {person.location && (
              <p className="mt-1 truncate text-xs text-slate-400" title={person.location}>
                📍 {person.location}
              </p>
            )}
          </div>
        </div>
      </div>

      {!linkState && (
        <>
          {person.parents.length < 2 && (
            <div className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
              <button
                title="Add new parent"
                className={addBtn}
                onClick={e => {
                  e.stopPropagation();
                  openAdd({ kind: "parent", childId: person.id, marryExisting: true });
                }}
              >
                +
              </button>
              <button
                title="Connect existing person as parent (their spouse joins too)"
                className={linkBtn}
                onClick={e => {
                  e.stopPropagation();
                  startLink("parent", person.id);
                }}
              >
                🔗
              </button>
            </div>
          )}
          <div className="absolute -right-3.5 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
            <button
              title="Add new spouse"
              className={addBtn}
              onClick={e => {
                e.stopPropagation();
                openAdd({ kind: "spouse", partnerId: person.id });
              }}
            >
              +
            </button>
            <button
              title="Connect existing person as spouse"
              className={linkBtn}
              onClick={e => {
                e.stopPropagation();
                startLink("spouse", person.id);
              }}
            >
              🔗
            </button>
          </div>
          <div className="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
            <button
              title="Add new child"
              className={addBtn}
              onClick={e => {
                e.stopPropagation();
                openAdd({ kind: "child", parentId: person.id });
              }}
            >
              +
            </button>
            <button
              title="Connect existing person as child"
              className={linkBtn}
              onClick={e => {
                e.stopPropagation();
                startLink("child", person.id);
              }}
            >
              🔗
            </button>
          </div>
        </>
      )}
    </div>
  );
}
