import { getViewportForBounds, type Node, useReactFlow } from "@xyflow/react"
import { useCallback, useState } from "react"

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

// Bounding box of every node for PDF fitting. Falls back to the layout's nominal
// card sizes (see layout.ts: NODE_WIDTH 176, NODE_HEIGHT 220, UNION_SIZE 12) when
// React Flow hasn't measured a node yet — otherwise unmeasured cards contribute
// zero size and the fit zooms in too far, clipping the rightmost/bottom cards.
function getExportBounds(nodes: Node[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const isUnion = node.type === "union"
    const width = node.measured?.width ?? (isUnion ? 12 : 176)
    const height = node.measured?.height ?? (isUnion ? 12 : 220)
    const { x, y } = node.position
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + width > maxX) maxX = x + width
    if (y + height > maxY) maxY = y + height
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// Print the whole tree to a PDF. Fits every node into a fixed page-sized box
// (independent of the on-screen canvas, so nothing gets clipped by a narrower
// print page), disables culling so off-screen nodes render, then hands off to
// the browser's print dialog ("Save as PDF"). The viewport is restored after.
export function usePdfExport() {
  const { fitView, getNodes, getViewport, setViewport } = useReactFlow()
  const [printing, setPrinting] = useState(false)

  const exportPdf = useCallback(async () => {
    // A4/Letter landscape printable area (6mm margin) in CSS px — fits both.
    const targetWidth = 960
    const targetHeight = 700
    const previous = getViewport()
    setPrinting(true)
    // Wait for onlyRenderVisibleElements to flip off so off-screen nodes mount
    // before computing bounds. getExportBounds falls back to nominal sizes for
    // any still-unmeasured card so the rightmost/bottom cards aren't clipped.
    await nextFrame()
    try {
      const bounds = getExportBounds(getNodes())
      if (bounds.width > 0 && bounds.height > 0) {
        const viewport = getViewportForBounds(
          bounds,
          targetWidth,
          targetHeight,
          0.1,
          2,
          0.06,
        )
        await setViewport(viewport)
      } else {
        await fitView({ padding: 0.15, duration: 0 })
      }
    } catch (error) {
      console.error("Failed to fit tree for PDF export", error)
      try {
        await fitView({ padding: 0.15, duration: 0 })
      } catch {
        // Ignore — still open the print dialog below.
      }
    }
    // Let the new viewport + the culling toggle paint before snapshotting.
    await nextFrame()
    await nextFrame()
    const done = () => {
      document.body.classList.remove("exporting-pdf")
      setPrinting(false)
      void setViewport(previous)
      window.removeEventListener("afterprint", done)
    }
    window.addEventListener("afterprint", done)
    document.body.classList.add("exporting-pdf")
    window.print()
  }, [fitView, getNodes, getViewport, setViewport])

  return { printing, exportPdf }
}
