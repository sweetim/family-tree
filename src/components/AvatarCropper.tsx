import { Check, X } from "lucide-react"
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { cropToAvatar } from "../lib/image"

const CROP_SIZE = 264

type Point = { x: number; y: number }

type Props = {
  src: string
  onConfirm: (avatar: string) => void
  onCancel: () => void
}

export function AvatarCropper({ src, onConfirm, onCancel }: Props) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ start: Point; origin: Point } | null>(null)

  // Load the image and initialise zoom/position so the shorter side fills
  // the crop square (a "cover" fit), centred.
  useEffect(() => {
    const el = new Image()
    el.onload = () => {
      imgRef.current = el
      const { naturalWidth: w, naturalHeight: h } = el
      const min = minScaleFor(w, h)
      setNaturalSize({ w, h })
      setScale(min)
      setOffset({ x: (CROP_SIZE - w * min) / 2, y: (CROP_SIZE - h * min) / 2 })
    }
    el.src = src
  }, [src])

  const minScale = useMemo(
    () => (naturalSize ? minScaleFor(naturalSize.w, naturalSize.h) : 1),
    [naturalSize],
  )
  const maxScale = useMemo(() => minScale * 4, [minScale])

  const clampOffset = useCallback(
    (x: number, y: number, s: number, size = naturalSize): Point => {
      if (!size) return { x, y }
      const minX = CROP_SIZE - size.w * s
      const minY = CROP_SIZE - size.h * s
      return {
        x: Math.min(0, Math.max(minX, x)),
        y: Math.min(0, Math.max(minY, y)),
      }
    },
    [naturalSize],
  )

  // Zoom while keeping the point under the crop centre fixed in the image.
  const zoomTo = useCallback(
    (next: number) => {
      if (!naturalSize) return
      const s = Math.min(maxScale, Math.max(minScale, next))
      setScale((prev) => {
        const cx = (CROP_SIZE / 2 - offset.x) / prev
        const cy = (CROP_SIZE / 2 - offset.y) / prev
        const o = clampOffset(CROP_SIZE / 2 - cx * s, CROP_SIZE / 2 - cy * s, s)
        setOffset(o)
        return s
      })
    },
    [naturalSize, offset.x, offset.y, minScale, maxScale, clampOffset],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!naturalSize) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    dragRef.current = {
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.start.x
    const dy = event.clientY - drag.start.y
    setOffset(clampOffset(drag.origin.x + dx, drag.origin.y + dy, scale))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointer already released
    }
  }

  // Wheel zoom (non-passive so we can preventDefault). Zoom around the
  // crop centre for predictable behaviour.
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomTo(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    area.addEventListener("wheel", onWheel, { passive: false })
    return () => area.removeEventListener("wheel", onWheel)
  }, [scale, zoomTo])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const img = imgRef.current
    if (!img || !naturalSize) return
    const sourceX = -offset.x / scale
    const sourceY = -offset.y / scale
    const sourceSize = CROP_SIZE / scale
    onConfirm(cropToAvatar(img, sourceX, sourceY, sourceSize))
  }

  // Render through a portal so the cropper's <form> is not nested inside
  // the sidebar's AddForm/EditForm <form> (which would make "Apply" submit
  // the outer form and reload the page), and so the fixed overlay escapes
  // the sidebar's transform containing block.
  if (typeof document === "undefined") return null
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape cancels (handled below)
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm animate-scale-in rounded-2xl bg-white p-5 shadow-lift"
      >
        <h2 className="text-base font-semibold text-slate-800">Adjust photo</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Drag to reposition · Scroll or slide to zoom
        </p>

        <div
          className="relative mx-auto mt-4 select-none overflow-hidden rounded-lg bg-slate-100 touch-none"
          style={{ width: CROP_SIZE, height: CROP_SIZE }}
        >
          <div
            ref={areaRef}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {naturalSize && (
              // biome-ignore lint/performance/noImgElement: in-memory crop preview rendered to a canvas; Next/Image adds no value
              <img
                src={src}
                alt="Crop preview"
                draggable={false}
                className="pointer-events-none max-w-none"
                style={{
                  position: "absolute",
                  left: offset.x,
                  top: offset.y,
                  width: naturalSize.w * scale,
                  height: naturalSize.h * scale,
                }}
              />
            )}
          </div>
          {/* Circle indicator: a rounded-full overlay with a huge box-shadow
              dims everything outside the circle so the round crop region is
              clearly visible. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/90"
            style={{ boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)" }}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-slate-400">Zoom</span>
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={(maxScale - minScale) / 100}
            value={scale}
            onChange={(event) => zoomTo(Number(event.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-cobalt-600"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <X className="h-4 w-4" /> Cancel
          </button>
          <button
            type="submit"
            disabled={!naturalSize}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Apply
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function minScaleFor(w: number, h: number): number {
  return CROP_SIZE / Math.min(w, h)
}
