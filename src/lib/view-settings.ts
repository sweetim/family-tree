import { useSyncExternalStore } from "react"

/**
 * Display/view preferences for the tree canvas. Global (not per-tree) and
 * persisted to localStorage so they survive reloads. Kept separate from the
 * family-data store: these are client-only preferences, never synced.
 */
export type ViewSettings = {
  minimap: boolean
  /**
   * Show each marriage's year next to its union dot on the canvas. The full
   * date is always available by hovering the dot; this only toggles the
   * always-on year label.
   */
  marriageYears: boolean
  /**
   * Render this family and every related family's members and relationships
   * on one canvas. A family is related when it shares at least one member
   * with the current one. Off (default): only the current family's members
   * are shown.
   */
  showAllFamilies: boolean
}

const STORAGE_KEY = "family-tree:view-settings"
const DEFAULTS: ViewSettings = {
  minimap: true,
  marriageYears: true,
  showAllFamilies: false,
}

function load(): ViewSettings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ViewSettings>) }
  } catch {
    return DEFAULTS
  }
}

let state: ViewSettings = load()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function updateViewSettings(patch: Partial<ViewSettings>): void {
  state = { ...state, ...patch }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota / privacy-mode write failures — settings just won't persist.
  }
  for (const listener of listeners) listener()
}

export function useViewSettings(): {
  settings: ViewSettings
  update: (patch: Partial<ViewSettings>) => void
} {
  const settings = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULTS,
  )
  return { settings, update: updateViewSettings }
}
