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

export const OUTCOME_TINT = {
  lead: "#cfe6d8",
  answered: "#d5e2f7",
  no_opportunity: "#f3e0c2",
  no_answer: "#dcdee2",
  other: "#dedad3",
} as const;
