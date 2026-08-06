/**
 * Layered z-index scale for the React Flow canvas.
 *
 * React Flow renders nodes and edges into the same stacking context (their
 * container panes set no z-index of their own), so a node's `zIndex` prop and
 * an edge's inline z-index compete directly. Keeping every tier here makes the
 * paint order explicit instead of relying on scattered magic numbers.
 *
 * Higher = paints on top. Gaps are intentional so new tiers slot in cleanly.
 *
 * The hovered-edge override in `globals.css` mirrors `edgeHovered` via the
 * `--z-edge-hovered` custom property — keep the two in sync.
 */
export const Z_INDEX = {
  /** Full-width generation row band — paints behind lines and cards. */
  generationBand: -10,
  /** Default relationship lines (marriage, parent→child). */
  edgeBase: 0,
  /** Animated father-to-son male-line connection. */
  edgeMaleLine: 500,
  /** Edge touching the currently selected person. */
  edgeSelected: 1000,
  /** Edge currently being hovered (for click-to-remove). */
  edgeHovered: 2000,
  /** Couple union dot — always on top so lines meet *under* it. */
  unionNode: 3000,
} as const
