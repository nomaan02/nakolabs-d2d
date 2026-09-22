# Raw data

Nothing in `raw/` is committed. Re-download from the sources below.

Contains OS data © Crown copyright and database right 2026. Contains public sector information licensed under the Open Government Licence v3.0. Map data © OpenStreetMap contributors.

| File | Source | Downloaded | Licence |
| --- | --- | --- | --- |
| osopenuprn_202608.csv | https://osdatahub.os.uk/downloads/open/OpenUPRN | 2026-09 | OGL v3.0 |
| bristol-nccz.geojson | Bristol City Council, gis_supportteam@bristol.gov.uk | pending — no download link on data.gov.uk | OGL v3.0 |
| bristol-roads.osm.json | Overpass API (`scripts/queries/bristol-roads.overpassql`) | 2026-09-19 | ODbL |
| bristol-roads-primary.osm.json | Same query, widened with `primary\|primary_link\|trunk\|trunk_link` | 2026-09-22 | ODbL |

OS Open UPRN is the whole of Great Britain. `scripts/ingest-uprn.ts` streams the CSV and keeps only points inside the Bristol bounding box (lon -2.72 to -2.45, lat 51.38 to 51.54), storing EPSG:4326 from the `LATITUDE` / `LONGITUDE` columns.

NCCZ polygons are expected in EPSG:27700. `scripts/ingest-nccz.ts` reprojects to EPSG:4326 at ingest. Until the council extract arrives, `nccz_zones` stays empty and every property's `is_nccz` is false.

OSM roads: inner Bristol, bbox lon -2.64 to -2.53, lat 51.43 to 51.51.
The 2026-09-19 file is
`residential|living_street|unclassified|tertiary|secondary|service`.
The 2026-09-22 file is that set plus
`primary|primary_link|trunk|trunk_link`. Neither includes
pedestrian or footway. Both were fetched once via Overpass `out geom`
(no node recursion). Ingest with `npm run ingest:roads`, or
`npm run ingest:roads -- --file=data/raw/bristol-roads-primary.osm.json`
for the widened extract. Do not commit the JSON.

## data/raw/epc-bristol/certificates.csv
Source:   https://get-energy-performance-data.communities.gov.uk/
Area:     Bristol, City of (E06000023), domestic EPCs
Original: 67be5466-3480-4d2f-9e66-950252b35171.csv
Rows:     ~184,000
Downloaded: 2026-09-16
Licence:  see LICENCE.txt in this folder. ADDRESS fields carry Royal Mail
          PAF-derived restrictions SEPARATE from the OGL covering the energy
          attributes. Do not redistribute address data in a licensed
          deployment without checking that licence.