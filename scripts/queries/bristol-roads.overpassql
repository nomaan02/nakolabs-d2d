// Inner Bristol road extract for Stage 1b (first run).
//
// Bbox is south,west,north,east — lon -2.64..-2.53, lat 51.43..51.51
// (Bishopston, Southville, Clifton, Northville). North edge is 51.51
// because the live Northville prop sits at 51.4986..51.5047; 51.49
// misses it. Still far narrower than the Section 13 city box so a
// recurse-to-nodes query cannot blow the 180s timeout.
//
// This run does NOT recurse. `out geom` puts node ids and coordinates
// on each way, so T-junctions still share one OSM node id without
// emitting every node as its own element.
//
// highway filter omits pedestrian|footway on purpose. Those are a
// second pass later, same tables, no schema change.
//
// Amended 2026-09-22: primary|primary_link|trunk|trunk_link added so
// transfer roads (Whiteladies Road / A4018, and the A38, including
// Filton Road) are in the graph. Same bbox, same `out geom` (no node
// recursion).
// The widened response is saved separately; do not overwrite
// data/raw/bristol-roads.osm.json.
//
// Commit this query. Never commit the JSON response.

[out:json][timeout:180];
way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|service|primary|primary_link|trunk|trunk_link)$"](51.43,-2.64,51.51,-2.53);
out geom;
