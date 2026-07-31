import { Mars, Venus } from "lucide-react"
import type { Gender } from "@/types"

const ICONS: Partial<Record<Gender, typeof Mars>> = {
  male: Mars,
  female: Venus,
}

export function GenderIcon({
  gender,
  className = "h-3 w-3",
}: {
  gender?: Gender
  className?: string
}) {
  if (!gender) return null
  const Icon = ICONS[gender]
  if (!Icon) return null
  return (
    <Icon
      className={className}
      aria-hidden="true"
    />
  )
}
