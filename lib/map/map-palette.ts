/** 2026-10-01 owner F1/F2. Figma: Map style v1. */

export const MAP_PALETTE = {
  ground: "#f6f4ef",
  landuse: "#f1eee7",
  park: "#e3eadb",
  water: "#d6e2ea",
  building: "#e4e1da",
  buildingEdge: "#d6d2ca",
  road: "#ffffff",
  roadMinorCase: "#e2dfd8",
  roadMajorCase: "#d3cfc6",
  label: "#4a5259",
  labelMuted: "#7c8188",
} as const;

export const OUTCOME_DOT = {
  lead: "#2f8f57",
  answered: "#3f74d0",
  no_opportunity: "#c77a12",
  no_answer: "#858a93",
  other: "#4a5259",
  open: "#ffffff",
  openRing: "#8a8f98",
  ring: "#ffffff",
} as const;

/** 2026-10-02 G2/G3 (phone check). */
export const OUTCOME_TINT = {
  lead: "#8fcfa8",
  answered: "#9dbcf0",
  no_opportunity: "#efc27f",
  no_answer: "#c3c7ce",
  other: "#c9c1b5",
} as const;

export const FOCUS = { line: "#1b4aa6", tint: "#c7d6f5" } as const;

export type MapMode = "light" | "dark";

export const MAP_PALETTE_DARK = {
  ground: "#2b3341",
  landuse: "#2e3644",
  park: "#23443a",
  water: "#2d4a6b",
  building: "#39414f",
  buildingEdge: "#464f5e",
  road: "#566174",
  roadMinorCase: "#252c38",
  roadMajorCase: "#20262f",
  label: "#c7cdd6",
  labelMuted: "#8f99a6",
} as const;

export const OUTCOME_DOT_DARK = {
  lead: "#45b877",
  answered: "#5b8ff0",
  no_opportunity: "#e09a3a",
  no_answer: "#9aa2ad",
  other: "#c2c9d2",
  open: "#2b3341",
  openRing: "#c2c9d2",
  ring: "#161a20",
} as const;

export const OUTCOME_TINT_DARK = {
  lead: "#2f6b4a",
  answered: "#34548c",
  no_opportunity: "#7a5a26",
  no_answer: "#4b525c",
  other: "#4f4a43",
} as const;

export const FOCUS_DARK = { line: "#8cb4ff", tint: "#33476b" } as const;

export const MAP_UI = {
  light: {
    halo: "#1c2226",
    core: "#fbfaf8",
    labelText: "#1c2226",
    labelHalo: "#fbfaf8",
    position: "#1b4aa6",
    positionRing: "#fbfaf8",
    placeholderLine: "#1c2226",
  },
  dark: {
    halo: "#eef1f4",
    core: "#161a20",
    labelText: "#eef1f4",
    labelHalo: "#161a20",
    position: "#8cb4ff",
    positionRing: "#161a20",
    placeholderLine: "#c2c9d2",
  },
} as const;

export function mapColours(mode: MapMode) {
  if (mode === "dark") {
    return {
      palette: MAP_PALETTE_DARK,
      dot: OUTCOME_DOT_DARK,
      tint: OUTCOME_TINT_DARK,
      focus: FOCUS_DARK,
      ui: MAP_UI.dark,
    };
  }
  return {
    palette: MAP_PALETTE,
    dot: OUTCOME_DOT,
    tint: OUTCOME_TINT,
    focus: FOCUS,
    ui: MAP_UI.light,
  };
}
