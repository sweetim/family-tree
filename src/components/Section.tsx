import { ChevronDown } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

type SectionProps = {
  title: string
  icon: ComponentType<{ className?: string }>
  count?: number
  children: ReactNode
}

export function Section({ title, icon: Icon, count, children }: SectionProps) {
  return (
    <details
      open
      className="group rounded-xl border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Icon className="h-4 w-4 text-slate-400" />
          {title}
        </span>
        <span className="inline-flex items-center gap-2">
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              {count}
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-2 border-t border-slate-100 p-3">{children}</div>
    </details>
  )
}
