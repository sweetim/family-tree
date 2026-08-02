import { Ban, Check, Eye, Loader2, Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export type RoleValue = "viewer" | "editor" | "none"

export const ROLE_ICON: Record<RoleValue, typeof Eye> = {
  editor: Pencil,
  viewer: Eye,
  none: Ban,
}

export const ROLE_OPTIONS: { value: RoleValue; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
]

function toneText(role: RoleValue) {
  if (role === "editor") return "text-emerald-600"
  if (role === "viewer") return "text-cobalt-600"
  return "text-slate-400"
}

function chipCls(role: RoleValue) {
  const ring = "ring-1"
  if (role === "editor")
    return `bg-emerald-50 ${ring} ring-emerald-200 text-emerald-600 hover:bg-emerald-100`
  if (role === "viewer")
    return `bg-cobalt-50 ${ring} ring-cobalt-200 text-cobalt-600 hover:bg-cobalt-100`
  return `bg-slate-50 ${ring} ring-slate-200 text-slate-400 hover:bg-slate-100`
}

/** Compact icon role picker with an optional no-access choice. */
export function RoleSelect({
  value,
  disabled,
  loading,
  label,
  allowNone = true,
  onChange,
}: {
  value: "viewer" | "editor" | undefined
  disabled: boolean
  loading: boolean
  label: string
  allowNone?: boolean
  onChange: (role: "viewer" | "editor" | null) => void
}) {
  const current: RoleValue = value ?? "none"
  const options = allowNone ? ROLE_OPTIONS : ROLE_OPTIONS.slice(1)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 176
    const menuHeight = allowNone ? 140 : 100
    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8)
      left = window.innerWidth - menuWidth - 8
    if (left < 8) left = 8
    let top = rect.bottom + 6
    if (top + menuHeight > window.innerHeight - 8)
      top = rect.top - menuHeight - 6
    if (top < 8) top = 8
    setCoords({ top, left })

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    function onScroll() {
      setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [allowNone, open])

  const Icon = ROLE_ICON[current]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${ROLE_OPTIONS.find((option) => option.value === current)?.label}`}
        onClick={() => setOpen((previous) => !previous)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${chipCls(current)}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: coords.top, left: coords.left }}
              className="fixed z-50 w-44 animate-scale-in rounded-xl border border-slate-200 bg-white p-1 shadow-lift"
            >
              {options.map((option) => {
                const OptionIcon = ROLE_ICON[option.value]
                const isCurrent = option.value === current
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange(option.value === "none" ? null : option.value)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                      isCurrent ? "text-slate-900" : "text-slate-600"
                    }`}
                  >
                    <OptionIcon
                      className={`h-4 w-4 ${toneText(option.value)}`}
                    />
                    <span className="flex-1 font-medium">{option.label}</span>
                    {isCurrent ? (
                      <Check className="h-4 w-4 text-cobalt-600" />
                    ) : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
