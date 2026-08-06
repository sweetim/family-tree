import { memo } from "react"
import type { GenerationNodeType } from "@/lib/layout"

/**
 * Generation row band — a full-width zebra-striped highlight for one
 * generation row, placed behind lines and cards by `buildFlow` when
 * "Generation labels" is on. The "Gen N" pill sits at the band's left edge so
 * the number labels the stripe when the left edge is in view, while the stripe
 * itself shows the generation wherever you pan.
 *
 * Non-interactive (`pointer-events-none`) so clicks pass through to the pane.
 */
function GenerationNodeBase({ data }: { data: GenerationNodeType["data"] }) {
  return (
    <div
      className={`pointer-events-none flex items-center ${
        data.even ? "bg-slate-200/60" : "bg-white/45"
      }`}
      style={{ width: data.width, height: data.height }}
    >
      <span className="ml-3 inline-flex h-6 w-16 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-xs font-semibold text-slate-500 shadow-soft backdrop-blur-sm">
        Gen {data.generation}
      </span>
    </div>
  )
}

export const GenerationNode = memo(GenerationNodeBase)
