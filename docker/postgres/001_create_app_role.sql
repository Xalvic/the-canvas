-- The official image runs this only when initializing an empty data volume.
-- Keep the API role separate from the image's PostgreSQL administrator.
\set ON_ERROR_STOP on
\getenv app_password SCRIBBLE_DB_PASSWORD

BEGIN;
CREATE ROLE scribble LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD :'app_password';
ALTER DATABASE scribble OWNER TO scribble;
COMMIT;
