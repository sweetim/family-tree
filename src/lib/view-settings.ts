import { useSyncExternalStore } from "react"

/**
 * Display/view preferences for the tree canvas. Global (not per-tree) and
 * persisted to localStorage so they survive reloads. Kept separate from the
 * family-data store: these are client-only preferences, never synced.
 */
export type ViewSettings = {
  minimap: boolean
}

const STORAGE_KEY = "family-tree:view-settings"
const DEFAULTS: ViewSettings = { minimap: true }

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
