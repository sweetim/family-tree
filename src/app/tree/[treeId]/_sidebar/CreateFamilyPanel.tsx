import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { createTreeWithRootMember, type FamilyStore } from "@/store"
import type { Person } from "@/types"
import { PersonFields } from "./PersonFields"
import {
  type Fields,
  fieldsFrom,
  inputCls,
  labelCls,
  sidebarFormIds,
  toInput,
} from "./shared"

export function CreateFamilyPanel({
  family,
  person,
}: {
  family: FamilyStore
  person: Person
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
      id={sidebarFormIds.createFamily}
      onSubmit={handleSubmit}
      className="animate-slide-up space-y-4"
    >
      <div>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">
            Create new family
          </h2>
          <p className="text-xs text-slate-500">
            Create a separate family tree for {person.name}'s parents.
          </p>
        </div>
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
    </form>
  )
}
