import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft, Crosshair, Download, Plus, Trash2, Upload, Users, X } from "lucide-react";
import { fileToAvatar } from "../lib/image";
import { normalizeImport, peekTree, type FamilyStore, type TreeMeta } from "../store";
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  type Gender,
  type Person,
  type PersonInput,
  type Relationship,
} from "../types";

export type SidebarState =
  | { mode: "idle" }
  | { mode: "add"; rel: Relationship }
  | { mode: "edit"; personId: string };

interface Props {
  family: FamilyStore;
  treeId: string;
  treeName: string;
  allTrees: TreeMeta[];
  state: SidebarState;
  onSelect: (id: string) => void;
  onAddRoot: () => void;
  onFocus: (id: string) => void;
  onClose: () => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50";
const ghostBtn = "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100";

interface Fields {
  name: string;
  gender: Gender | "";
  dob: string;
  dod: string;
  location: string;
  photo?: string;
}

function fieldsFrom(p?: Person): Fields {
  return {
    name: p?.name ?? "",
    gender: p?.gender ?? "",
    dob: p?.dob ?? "",
    dod: p?.dod ?? "",
    location: p?.location ?? "",
    photo: p?.photo,
  };
}

function toInput(f: Fields): PersonInput {
  return {
    name: f.name.trim(),
    gender: f.gender || undefined,
    dob: f.dob || undefined,
    dod: f.dod || undefined,
    location: f.location.trim() || undefined,
    photo: f.photo,
  };
}

function PersonFields({ fields, onChange }: { fields: Fields; onChange: (f: Fields) => void }) {
  const [photoError, setPhotoError] = useState<string>();

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(undefined);
    try {
      onChange({ ...fields, photo: await fileToAvatar(file) });
    } catch (err) {
      console.error(err);
      setPhotoError("Could not read that image, try another file.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Name *</label>
        <input
          autoFocus
          required
          value={fields.name}
          onChange={e => onChange({ ...fields, name: e.target.value })}
          placeholder="e.g. Grace Tan"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Gender</label>
        <select
          value={fields.gender}
          onChange={e => onChange({ ...fields, gender: e.target.value as Fields["gender"] })}
          className={inputCls}
        >
          <option value="">Not specified</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Born</label>
          <input
            type="date"
            value={fields.dob}
            onChange={e => onChange({ ...fields, dob: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Died</label>
          <input
            type="date"
            value={fields.dod}
            onChange={e => onChange({ ...fields, dod: e.target.value })}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Location</label>
        <input
          value={fields.location}
          onChange={e => onChange({ ...fields, location: e.target.value })}
          placeholder="e.g. Singapore"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Photo</label>
        <div className="flex items-center gap-3">
          {fields.photo ? (
            <img src={fields.photo} alt="preview" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-slate-100" />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={e => handlePhoto(e.target.files?.[0])}
            className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-600 hover:file:bg-indigo-100"
          />
        </div>
        {photoError && <p className="mt-1 text-xs text-red-500">{photoError}</p>}
      </div>
    </div>
  );
}

function AddForm({ family, rel, onDone, onClose }: {
  family: FamilyStore;
  rel: Relationship;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const { people } = family;
  const [fields, setFields] = useState<Fields>(fieldsFrom());
  const [adopted, setAdopted] = useState(false);
  const [marryExisting, setMarryExisting] = useState(true);

  const parent = rel.kind === "child" ? people[rel.parentId] : undefined;
  const [otherParentId, setOtherParentId] = useState(parent?.spouseIds[0] ?? "");

  let heading = "New member";
  if (rel.kind === "child" && parent) heading = `Child of ${parent.name}`;
  if (rel.kind === "spouse") heading = `Spouse of ${people[rel.partnerId]?.name ?? "?"}`;
  if (rel.kind === "parent") heading = `Parent of ${people[rel.childId]?.name ?? "?"}`;

  const child = rel.kind === "parent" ? people[rel.childId] : undefined;
  const existingParent = child?.parents[0] ? people[child.parents[0].id] : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const input = toInput(fields);
    if (!input.name) return;

    let finalRel: Relationship = rel;
    if (rel.kind === "child") {
      finalRel = { ...rel, otherParentId: otherParentId || undefined, adopted: adopted || undefined };
    } else if (rel.kind === "parent") {
      finalRel = { ...rel, marryExisting: marryExisting && !!existingParent };
    }
    onDone(family.addPerson(input, finalRel));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Add member</h2>
        <p className="text-xs text-slate-400">{heading}</p>
      </div>

      <PersonFields fields={fields} onChange={setFields} />

      {rel.kind === "child" && parent && (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>Other parent</label>
            <select value={otherParentId} onChange={e => setOtherParentId(e.target.value)} className={inputCls}>
              <option value="">None (single parent)</option>
              {parent.spouseIds
                .filter(sid => people[sid])
                .map(sid => (
                  <option key={sid} value={sid}>
                    {people[sid]!.name}
                  </option>
                ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={adopted} onChange={e => setAdopted(e.target.checked)} />
            Adopted
          </label>
        </div>
      )}

      {rel.kind === "parent" && existingParent && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={marryExisting}
            onChange={e => setMarryExisting(e.target.checked)}
          />
          Married to {existingParent.name}
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={ghostBtn}>
          Cancel
        </button>
        <button type="submit" className={primaryBtn}>
          Add member
        </button>
      </div>
    </form>
  );
}

function EditForm({ family, treeId, allTrees, person, onSelect, onFocus, onClose }: {
  family: FamilyStore;
  treeId: string;
  allTrees: TreeMeta[];
  person: Person;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  const { people } = family;
  const [fields, setFields] = useState<Fields>(fieldsFrom(person));
  const navigate = useNavigate();

  const otherTrees = allTrees.filter(t => t.id !== treeId);
  const [linkTreeId, setLinkTreeId] = useState("");
  const crossLinks = useMemo(
    () =>
      (person.links ?? []).map(link => ({
        link,
        treeName: allTrees.find(t => t.id === link.treeId)?.name ?? "Unknown tree",
        personName: peekTree(link.treeId)[link.personId]?.name ?? "?",
      })),
    [person.links, allTrees],
  );
  const linkCandidates = useMemo(() => {
    if (!linkTreeId) return [];
    const linked = new Set((person.links ?? []).map(l => `${l.treeId}:${l.personId}`));
    return Object.values(peekTree(linkTreeId)).filter(p => !linked.has(`${linkTreeId}:${p.id}`));
  }, [linkTreeId, person.links]);

  const spouses = person.spouseIds.map(id => people[id]).filter((p): p is Person => !!p);
  const parents = person.parents
    .map(link => ({ link, person: people[link.id] }))
    .filter((x): x is { link: (typeof person.parents)[number]; person: Person } => !!x.person);
  const children = childrenOf(people, person.id);
  const linkable = Object.values(people).filter(
    p => p.id !== person.id && !person.spouseIds.includes(p.id),
  );

  // Linking an ancestor as a child (or a descendant as a parent) would
  // make someone their own ancestor, so those candidates are excluded.
  const ancestors = ancestorsOf(people, person.id);
  const descendants = descendantsOf(people, person.id);
  const parentCandidates = Object.values(people).filter(
    p =>
      p.id !== person.id &&
      !person.parents.some(l => l.id === p.id) &&
      !descendants.has(p.id),
  );
  const childCandidates = Object.values(people).filter(
    p =>
      p.id !== person.id &&
      p.parents.length < 2 &&
      !p.parents.some(l => l.id === person.id) &&
      !ancestors.has(p.id),
  );

  // Married couples where both partners are eligible — offered as a single
  // option that links both parents at once (needs both parent slots free).
  const candidateIds = new Set(parentCandidates.map(p => p.id));
  const coupleCandidates: [Person, Person][] = [];
  if (person.parents.length === 0) {
    for (const p of parentCandidates) {
      for (const sid of p.spouseIds) {
        if (p.id < sid && candidateIds.has(sid)) coupleCandidates.push([p, people[sid]!]);
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const input = toInput(fields);
    if (!input.name) return;
    family.updatePerson(person.id, input);
  }

  const chip = "flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs text-slate-700";
  const chipX = "flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-red-500";

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Edit member</h2>
            <p className="text-xs text-slate-400">{person.name}</p>
          </div>
          <button
            type="button"
            title={`Show only ${person.name}'s blood relatives and their spouses`}
            onClick={() => onFocus(person.id)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100"
          >
            <Crosshair className="h-3.5 w-3.5" /> View their family
          </button>
        </div>

        <PersonFields fields={fields} onChange={setFields} />

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ghostBtn}>
            Close
          </button>
          <button type="submit" className={primaryBtn}>
            Save
          </button>
        </div>
      </form>

      <div className="space-y-4 border-t border-slate-200 pt-4">
        <div>
          <label className={labelCls}>Spouses</label>
          <div className="flex flex-wrap gap-1.5">
            {spouses.length === 0 && <p className="text-xs text-slate-400">None</p>}
            {spouses.map(s => (
              <span key={s.id} className={chip}>
                <button type="button" className="hover:underline" onClick={() => onSelect(s.id)}>
                  {s.name}
                </button>
                <button
                  type="button"
                  title="Remove marriage"
                  className={chipX}
                  onClick={() => family.unlinkSpouse(person.id, s.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {linkable.length > 0 && (
            <select
              value=""
              onChange={e => e.target.value && family.linkSpouse(person.id, e.target.value)}
              className={`${inputCls} mt-2`}
            >
              <option value="">+ Link existing person as spouse…</option>
              {linkable.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className={labelCls}>Parents</label>
          {parents.length === 0 && <p className="text-xs text-slate-400">None</p>}
          <div className="space-y-1.5">
            {parents.map(({ link, person: par }) => (
              <div key={par.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                <button type="button" className="text-xs text-slate-700 hover:underline" onClick={() => onSelect(par.id)}>
                  {par.name}
                </button>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={!!link.adopted}
                      onChange={e => family.setParentAdopted(person.id, par.id, e.target.checked)}
                    />
                    adopted
                  </label>
                  <button
                    type="button"
                    title="Remove parent link"
                    className={chipX}
                    onClick={() => family.removeParent(person.id, par.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {person.parents.length < 2 && parentCandidates.length > 0 && (
            <select
              value=""
              onChange={e => {
                for (const id of e.target.value.split("|").filter(Boolean)) {
                  family.addParent(person.id, id);
                }
              }}
              className={`${inputCls} mt-2`}
            >
              <option value="">+ Link existing person as parent…</option>
              {coupleCandidates.length > 0 && (
                <optgroup label="Couples (links both)">
                  {coupleCandidates.map(([a, b]) => (
                    <option key={`${a.id}|${b.id}`} value={`${a.id}|${b.id}`}>
                      {a.name} &amp; {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Individuals">
                {parentCandidates.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </div>

        <div>
          <label className={labelCls}>Children</label>
          <div className="flex flex-wrap gap-1.5">
            {children.length === 0 && <p className="text-xs text-slate-400">None</p>}
            {children.map(c => (
              <span key={c.id} className={chip}>
                <button type="button" className="hover:underline" onClick={() => onSelect(c.id)}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          {childCandidates.length > 0 && (
            <select
              value=""
              onChange={e => e.target.value && family.addParent(e.target.value, person.id)}
              className={`${inputCls} mt-2`}
            >
              <option value="">+ Link existing person as child…</option>
              {childCandidates.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className={labelCls}>Other families</label>
          <div className="flex flex-wrap gap-1.5">
            {crossLinks.length === 0 && (
              <p className="text-xs text-slate-400">Not linked to any other tree</p>
            )}
            {crossLinks.map(({ link, treeName, personName }) => (
              <span key={`${link.treeId}:${link.personId}`} className={chip}>
                <button
                  type="button"
                  title={`Open ${personName} in ${treeName}`}
                  className="hover:underline"
                  onClick={() => {
                    navigate(`/tree/${link.treeId}/p/${link.personId}`);
                  }}
                >
                  {personName} · {treeName}
                </button>
                <button
                  type="button"
                  title="Remove link"
                  className={chipX}
                  onClick={() => family.removeCrossLink(person.id, link)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {otherTrees.length > 0 && (
            <div className="mt-2 space-y-2">
              <select value={linkTreeId} onChange={e => setLinkTreeId(e.target.value)} className={inputCls}>
                <option value="">+ Link to this person in another tree…</option>
                {otherTrees.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {linkTreeId && (
                <select
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    family.addCrossLink(person.id, { treeId: linkTreeId, personId: e.target.value });
                    setLinkTreeId("");
                  }}
                  className={inputCls}
                >
                  <option value="">
                    {linkCandidates.length > 0 ? "Who are they in that tree?" : "No one left to link in that tree"}
                  </option>
                  {linkCandidates.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove ${person.name} from the tree?`)) {
              family.deletePerson(person.id);
              onClose();
            }
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Delete {person.name}
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ family, treeId, treeName, allTrees, state, onSelect, onAddRoot, onFocus, onClose }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const count = Object.keys(family.people).length;

  function exportJson() {
    const blob = new Blob([JSON.stringify(family.people, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "family-tree.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    try {
      const data = normalizeImport(JSON.parse(await file.text()));
      const valid = Object.values(data).every(
        p => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.parents),
      );
      if (!valid) throw new Error("Unrecognised format");
      family.replaceAll(data);
      onClose();
    } catch (err) {
      console.error(err);
      alert("That file doesn't look like an exported family tree.");
    }
  }

  const editingPerson = state.mode === "edit" ? family.people[state.personId] : undefined;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <Link to="/" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
          <ChevronLeft className="h-3.5 w-3.5" /> All trees
        </Link>
        <h1 className="text-lg font-bold text-slate-800">{treeName}</h1>
        <p className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Users className="h-3.5 w-3.5" />
          {count} members · hover a card for quick actions
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {state.mode === "add" && (
          <AddForm
            key={JSON.stringify(state.rel)}
            family={family}
            rel={state.rel}
            onDone={onSelect}
            onClose={onClose}
          />
        )}

        {editingPerson && (
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
        )}

        {state.mode === "idle" || (state.mode === "edit" && !editingPerson) ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Click a card to edit it, or hover a card and use the <b>+</b> buttons to add a new
              parent, spouse or child — or the <b>link</b> buttons to connect two people already in
              the tree by clicking their cards.
            </p>
            <button onClick={onAddRoot} className={`${primaryBtn} w-full`}>
              <Plus className="h-4 w-4" /> Add unconnected member
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-200 px-5 py-4">
        <button onClick={exportJson} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50">
          <Download className="h-4 w-4" /> Export JSON
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
        >
          <Upload className="h-4 w-4" /> Import JSON
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={e => {
            importJson(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
