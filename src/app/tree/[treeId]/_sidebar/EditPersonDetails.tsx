import { type FormEvent, useState } from "react"
import { photoProxyUrl } from "@/lib/image"
import type { FamilyStore } from "@/store"
import type { PersonIdentity } from "@/types"
import { PersonFields } from "./PersonFields"
import { fieldsFrom, sidebarFormIds, toInput } from "./shared"

/**
 * Details-only editor for a person who isn't a member of this tree (e.g. an
 * ancestor parent shown from another tree). Only the shared identity fields are
 * editable — relationship sections don't apply — and edits go to the global
 * person record, so they take effect everywhere the person appears.
 */
export function EditPersonDetails({
  family,
  person,
  onSaved,
}: {
  family: FamilyStore
  person: PersonIdentity
  onSaved?: () => void
}) {
  const [fields, setFields] = useState(fieldsFrom(person))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const input = toInput(fields)
    if (!input.name) return
    family.updatePerson(person.id, input)
    onSaved?.()
  }

  return (
    <div className="animate-slide-up space-y-5">
      <form
        id={sidebarFormIds.editPerson}
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-soft"
      >
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">
            Edit details
          </h2>
          <p className="text-xs text-slate-400">
            {person.name} isn&rsquo;t in this tree — only their shared details
            are edited here.
          </p>
        </div>

        <PersonFields
          fields={fields}
          onChange={setFields}
          existingPhotoUrl={
            person.photo
              ? photoProxyUrl(person.id, person.photoUpdatedAt)
              : undefined
          }
        />
      </form>
    </div>
  )
}
