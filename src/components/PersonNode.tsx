import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PersonNodeType } from "../lib/layout";
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
  "nodrag nopan pointer-events-auto absolute z-10 hidden h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-base font-bold leading-none text-white shadow-md transition-colors hover:bg-indigo-500 group-hover:flex";

export function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  const { person } = data;
  const { openAdd } = useTreeActions();
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
          selected ? "border-indigo-500 ring-2 ring-indigo-300" : "border-slate-200"
        } ${deceased ? "opacity-80" : ""}`}
      >
        <Handle id="t" type="target" position={Position.Top} className={hiddenHandle} />
        <Handle id="l" type="source" position={Position.Left} className={hiddenHandle} />
        <Handle id="r" type="source" position={Position.Right} className={hiddenHandle} />
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

      {person.parents.length < 2 && (
        <button
          title="Add parent"
          className={`${addBtn} -top-3.5 left-1/2 -translate-x-1/2`}
          onClick={e => {
            e.stopPropagation();
            openAdd({ kind: "parent", childId: person.id, marryExisting: true });
          }}
        >
          +
        </button>
      )}
      <button
        title="Add spouse"
        className={`${addBtn} -right-3.5 top-1/2 -translate-y-1/2`}
        onClick={e => {
          e.stopPropagation();
          openAdd({ kind: "spouse", partnerId: person.id });
        }}
      >
        +
      </button>
      <button
        title="Add child"
        className={`${addBtn} -bottom-3.5 left-1/2 -translate-x-1/2`}
        onClick={e => {
          e.stopPropagation();
          openAdd({ kind: "child", parentId: person.id });
        }}
      >
        +
      </button>
    </div>
  );
}
