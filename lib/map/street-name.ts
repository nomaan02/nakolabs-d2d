/**
 * Street plate used by the field instruction cards and by route legs.
 * One copy, no imports, so `lib/map` and `lib/field` can share it
 * without a cycle.
 */

const NOT_A_STREET = new Set(["service road", "unnamed road"]);

export function plateStreet(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (NOT_A_STREET.has(trimmed.toLowerCase())) return null;
  return trimmed;
}
