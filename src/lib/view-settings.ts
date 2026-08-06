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
  /** Show a living person's age beside their birth year on their card. */
  showAge: boolean
  /** Center the selected person's card in view mode. */
  focusSelectedPerson: boolean
  /**
   * Show each person's family name before their name on their card
   * (e.g. "Tan Tim"). On (default): the family name is shown; off: only the
   * name is shown.
   */
  showFamilyName: boolean
  /**
   * Render this family and every related family's members and relationships
   * on one canvas. A family is related when it shares at least one member
   * with the current one. Off (default): only the current family's members
   * are shown.
   */
  showAllFamilies: boolean
  /**
   * Highlight the family bloodline: male-line members in red, other
   * bloodline members in amber, and married-in spouses dimmed.
   */
  highlightBloodline: boolean
  /** Hide married-in spouses while bloodline highlighting is enabled. */
  hideNonDescendants: boolean
  /** Show only the direct male line while bloodline highlighting is enabled. */
  hideAmberBloodline: boolean
  /**
   * Show a badge on each person card for every other family tree they
   * belong to. Off (default): the badges are hidden on the canvas.
   */
  showOtherTrees: boolean
  /**
   * Show a "Gen N" label on the left margin of each generation row,
   * numbered from the topmost row down. Off (default): no labels.
   */
  showGenerations: boolean
  /**
   * Integer added to every generation row's number when "Generation labels"
   * is on. 0 (default): top row is Gen 1; -1: top row is Gen 0; -3: top row
   * is Gen -2; 4: top row is Gen 5. Shifts all rows together.
   */
  generationOffset: number
}

const STORAGE_KEY = "family-tree:view-settings"
const DEFAULTS: ViewSettings = {
  minimap: false,
  marriageYears: true,
  showAge: true,
  focusSelectedPerson: true,
  showFamilyName: true,
  showAllFamilies: false,
  highlightBloodline: false,
  hideNonDescendants: false,
  hideAmberBloodline: false,
  showOtherTrees: false,
  showGenerations: false,
  generationOffset: 0,
}

type StoredViewSettings = Partial<ViewSettings> & {
  highlightMaleLine?: boolean
  hideFemaleDescendants?: boolean
}

function load(): ViewSettings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const { highlightMaleLine, hideFemaleDescendants, ...stored } = JSON.parse(
      raw,
    ) as StoredViewSettings
    return {
      ...DEFAULTS,
      ...stored,
      highlightBloodline:
        stored.highlightBloodline || highlightMaleLine || false,
      hideAmberBloodline:
        stored.hideAmberBloodline || hideFemaleDescendants || false,
    }
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
