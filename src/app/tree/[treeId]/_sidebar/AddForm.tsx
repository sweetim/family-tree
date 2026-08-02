import { type FormEvent, useState } from "react"
import type { FamilyStore } from "@/store"
import type { Relationship } from "@/types"
import { BackToChoose } from "./BackToChoose"
import { PersonFields } from "./PersonFields"
import {
  chooseFromRel,
  type Fields,
  fieldsFrom,
  labelCls,
  primaryBtn,
  selectCls,
  toInput,
} from "./shared"

export function AddForm({
  family,
  rel,
  onDone,
}: {
  family: FamilyStore
  rel: Relationship
  onDone: (id: string) => void
}) {
  const { people } = family
  // A child is a descendant of the family, so prefill their family name from
  // the parent they're being added under (when the parent has one set).
  const seedFamilyName =
    rel.kind === "child" ? (people[rel.parentId]?.familyName ?? "") : ""
  const [fields, setFields] = useState<Fields>(() => ({
    ...fieldsFrom(),
    familyName: seedFamilyName,
  }))
  const [adopted, setAdopted] = useState(false)
  const [marryExisting, setMarryExisting] = useState(true)

  const parent = rel.kind === "child" ? people[rel.parentId] : undefined
  const [otherParentId, setOtherParentId] = useState(parent?.spouseIds[0] ?? "")

  let heading = "New member"
  if (rel.kind === "child" && parent) heading = `Child of ${parent.name}`
  if (rel.kind === "spouse")
    heading = `Spouse of ${people[rel.partnerId]?.name ?? "?"}`
  if (rel.kind === "parent")
    heading = `Parent of ${people[rel.childId]?.name ?? "?"}`

  const child = rel.kind === "parent" ? people[rel.childId] : undefined
  const existingParent = child?.parents[0]
    ? people[child.parents[0].id]
    : undefined
  const backTarget = chooseFromRel(rel)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = toInput(fields)
    if (!input.name) return

    let finalRel: Relationship = rel
    if (rel.kind === "child") {
      finalRel = {
        ...rel,
        otherParentId: otherParentId || undefined,
        adopted: adopted || undefined,
      }
    } else if (rel.kind === "parent") {
      finalRel = { ...rel, marryExisting: marryExisting && !!existingParent }
    }
    onDone(family.addPerson(input, finalRel))
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-slide-up space-y-4"
    >
      <div>
        {backTarget && (
          <BackToChoose
            kind={backTarget.kind}
            sourceId={backTarget.sourceId}
            rel={rel}
          />
        )}
        <h2 className="text-base font-semibold tracking-tight text-slate-800">
          Add member
        </h2>
        <p className="text-xs text-slate-400">{heading}</p>
      </div>

      <PersonFields
        fields={fields}
        onChange={setFields}
      />

      {rel.kind === "child" && parent && (
        <div className="space-y-2">
          <div>
            <label
              htmlFor="field-other-parent"
              className={labelCls}
            >
              Other parent
            </label>
            <select
              id="field-other-parent"
              value={otherParentId}
              onChange={(e) => setOtherParentId(e.target.value)}
              className={selectCls}
            >
              <option value="">None (single parent)</option>
              {parent.spouseIds
                .filter((sid) => people[sid])
                .map((sid) => (
                  <option
                    key={sid}
                    value={sid}
                  >
                    {people[sid]?.name}
                  </option>
                ))}
            </select>
          </div>
          <label className="flex min-h-[40px] items-center gap-2 px-1 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={adopted}
              onChange={(e) => setAdopted(e.target.checked)}
            />
            Adopted
          </label>
        </div>
      )}

      {rel.kind === "parent" && existingParent && (
        <label className="flex min-h-[40px] items-center gap-2 px-1 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={marryExisting}
            onChange={(e) => setMarryExisting(e.target.checked)}
          />
          Married to {existingParent.name}
        </label>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          className={primaryBtn}
        >
          Save
        </button>
      </div>
    </form>
  )
}
