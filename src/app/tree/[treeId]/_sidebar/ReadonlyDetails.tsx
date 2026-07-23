import { Baby, Heart, MapPin, Users } from "lucide-react"
import { Section } from "@/components/Section"
import type { FamilyStore } from "@/store"
import { childrenOf, type Person } from "@/types"
import { RelationList } from "./RelationList"

function yearOf(iso: string): string {
  const y = new Date(iso).getFullYear()
  return Number.isNaN(y) ? "?" : String(y)
}

export function ReadonlyDetails({
  family,
  person,
  onSelect,
}: {
  family: FamilyStore
  person: Person
  onSelect: (id: string) => void
}) {
  const { people } = family
  const spouses = person.spouseIds
    .map((id) => people[id])
    .filter((p): p is Person => !!p)
  const parents = person.parents
    .map((link) => people[link.id])
    .filter((p): p is Person => !!p)
  const children = childrenOf(people, person.id)

  const deceased = !!person.dod
  let lifeline: string | null = null
  if (deceased && person.dod) {
    lifeline = `${person.dob ? yearOf(person.dob) : "?"} – ${yearOf(person.dod)} †`
  } else if (person.dob) {
    lifeline = yearOf(person.dob)
  }

  const initials =
    person.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"

  return (
    <div className="animate-slide-up space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="flex items-center gap-3">
          {person.photo ? (
            // biome-ignore lint/performance/noImgElement: data-URL of the person's photo
            <img
              src={person.photo}
              alt={person.name}
              className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-100"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-slate-800">
              {person.name}
            </h2>
            {lifeline && (
              <p className="mt-0.5 text-xs text-slate-500">{lifeline}</p>
            )}
            {person.location && (
              <p className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-slate-400">
                <MapPin className="h-3 w-3" /> {person.location}
              </p>
            )}
            {person.gender && (
              <p className="mt-0.5 text-xs capitalize text-slate-400">
                {person.gender}
              </p>
            )}
          </div>
        </div>
      </div>

      <Section
        title="Parents"
        icon={Users}
        count={parents.length}
      >
        <RelationList
          people={parents}
          onSelect={onSelect}
        />
      </Section>
      <Section
        title="Spouses"
        icon={Heart}
        count={spouses.length}
      >
        <RelationList
          people={spouses}
          onSelect={onSelect}
        />
      </Section>
      <Section
        title="Children"
        icon={Baby}
        count={children.length}
      >
        <RelationList
          people={children}
          onSelect={onSelect}
        />
      </Section>
    </div>
  )
}
