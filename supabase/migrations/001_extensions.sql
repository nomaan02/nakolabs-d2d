-- Stage 1: extensions required by properties / nccz_zones.
-- postgis: geometry(Point|Polygon,4326). pgcrypto: gen_random_uuid().

create extension if not exists postgis;
create extension if not exists pgcrypto;
