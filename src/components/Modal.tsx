import { type ReactNode, useEffect } from "react"
import { createPortal } from "react-dom"

type ModalProps = {
  onClose: () => void
  /**
   * Backdrop + layout classes. Each call site keeps its exact styling
   * (blur, animation, etc.), so this only centralises the Escape listener,
   * backdrop-click handling, and optional portal.
   */
  backdropClassName?: string
  children: ReactNode
  /** Render through a `document.body` portal (e.g. a form nested in a form). */
  portal?: boolean
}

export function Modal({
  onClose,
  backdropClassName,
  children,
  portal,
}: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const overlay = (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled above) is the keyboard equivalent
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
    <div
      className={backdropClassName}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )

  if (portal) {
    if (typeof document === "undefined") return null
    return createPortal(overlay, document.body)
  }
  return overlay
}
