import { X } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { createTreeWithRootMember, type FamilyStore } from "@/store"
import type { Person } from "@/types"
import { PersonFields } from "./PersonFields"
import {
  type Fields,
  fieldsFrom,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
  toInput,
} from "./shared"

export function CreateFamilyPanel({
  family,
  person,
  treeName,
  onClose,
}: {
  family: FamilyStore
  person: Person
  treeName: string
  onClose: () => void
}) {
  const router = useRouter()
  const [familyName, setFamilyName] = useState("")
  const [fields, setFields] = useState<Fields>(fieldsFrom())

  const canSave = familyName.trim().length > 0 && fields.name.trim().length > 0

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    // Create the tree + the new parent, then bring this person's subtree
    // (them, their descendants, and their spouses) into the new tree and link
    // the new parent above them — same move as connecting an existing parent
    // across trees.
    const { treeId, personId } = createTreeWithRootMember(
      familyName.trim(),
      toInput(fields),
    )
    family.linkParentAcrossTrees(person.id, treeId, personId)
    router.push(`/tree/${treeId}`)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-slide-up space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">
            Create new family
          </h2>
          <p className="text-xs text-slate-500">
            {person.name} married into {treeName}. Create a new family for their
            parents.
          </p>
        </div>
        <button
          type="button"
          title="Close"
          className={ghostBtn}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label
          htmlFor="field-family-name"
          className={labelCls}
        >
          Family tree name *
        </label>
        <input
          id="field-family-name"
          required
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          placeholder="e.g. The Lee Family"
          className={inputCls}
        />
      </div>

      <div className="border-t border-slate-200 pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Parent
        </p>
        <PersonFields
          fields={fields}
          onChange={setFields}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className={ghostBtn}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave}
          className={primaryBtn}
        >
          Save &amp; open
        </button>
      </div>
    </form>
  )
}
