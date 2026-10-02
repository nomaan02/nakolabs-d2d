import { anchorDoors, type AnchorDoor, type AnchorStep } from "@/lib/map/door-anchors";
import type { DoorCollection, DoorProperties } from "@/lib/geo/todays-assignment";

/**
 * Display geometry for the field maps. An empty step list returns the same
 * collection, so a route that has not loaded yet does not copy 2,000 features.
 */
export function anchorDoorCollection(doors: DoorCollection, steps: AnchorStep[]): DoorCollection {
  if (steps.length === 0) return doors;
  const input: AnchorDoor[] = doors.features.map((feature) => ({
    uprn: feature.properties.uprn,
    sequence: feature.properties.sequence,
    coordinates: [feature.geometry.coordinates[0]!, feature.geometry.coordinates[1]!],
  }));
  const placed = anchorDoors(input, steps);
  const byUprn = new Map(placed.map((door) => [door.uprn, door]));
  return {
    type: "FeatureCollection",
    features: doors.features.map((feature) => {
      const door = byUprn.get(feature.properties.uprn);
      const properties: DoorProperties & { anchored: boolean; raw_lng: number; raw_lat: number } = {
        ...feature.properties,
        anchored: door?.anchored ?? false,
        raw_lng: feature.geometry.coordinates[0]!,
        raw_lat: feature.geometry.coordinates[1]!,
      };
      const coordinates = door?.coordinates ?? [
        feature.geometry.coordinates[0]!,
        feature.geometry.coordinates[1]!,
      ];
      return {
        ...feature,
        geometry: { type: "Point", coordinates },
        properties,
      };
    }),
  };
}
