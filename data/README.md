# Raw data

Nothing in `raw/` is committed. Re-download from the sources below.

Contains OS data © Crown copyright and database right 2026. Contains public sector information licensed under the Open Government Licence v3.0. Map data © OpenStreetMap contributors.

| File | Source | Downloaded | Licence |
| --- | --- | --- | --- |
| osopenuprn_202608.csv | https://osdatahub.os.uk/downloads/open/OpenUPRN | 2026-09 | OGL v3.0 |
| bristol-nccz.geojson | Bristol City Council, gis_supportteam@bristol.gov.uk | pending — no download link on data.gov.uk | OGL v3.0 |
| bristol-roads.osm.json | Overpass API | not yet needed (Stage 1b) | ODbL |

OS Open UPRN is the whole of Great Britain. `scripts/ingest-uprn.ts` streams the CSV and keeps only points inside the Bristol bounding box (lon -2.72 to -2.45, lat 51.38 to 51.54), storing EPSG:4326 from the `LATITUDE` / `LONGITUDE` columns.

NCCZ polygons are expected in EPSG:27700. `scripts/ingest-nccz.ts` reprojects to EPSG:4326 at ingest. Until the council extract arrives, `nccz_zones` stays empty and every property's `is_nccz` is false.
