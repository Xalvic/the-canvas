-- SQL remains the migration authority. Existing boards/documents are untouched.
-- Keep original scope and provider cleanup metadata after board deletion.
CREATE TABLE board_assets (
  id uuid PRIMARY KEY,
  board_id uuid REFERENCES boards(id) ON DELETE SET NULL,
  scope_board_id uuid NOT NULL,
  uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleting', 'failed')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  provider_file_id text UNIQUE,
  provider_file_path text NOT NULL UNIQUE CHECK (char_length(provider_file_path) BETWEEN 1 AND 1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_referenced_at timestamptz,
  CHECK (board_id IS NULL OR board_id = scope_board_id),
  CHECK (width::bigint * height::bigint <= 16000000),
  CHECK (provider_file_id IS NULL OR char_length(provider_file_id) BETWEEN 1 AND 255),
  CHECK (status <> 'ready' OR provider_file_id IS NOT NULL),
  CHECK (last_referenced_at IS NULL OR status = 'ready')
);
CREATE INDEX board_assets_board_created_idx ON board_assets(scope_board_id, created_at);
CREATE INDEX board_assets_uploader_created_idx ON board_assets(uploader_id, created_at);
CREATE INDEX board_assets_cleanup_idx ON board_assets(status, created_at, updated_at) WHERE last_referenced_at IS NULL;

-- Issuance budgets persist across API restarts. They bound newly issued signed
-- URLs, not subsequent CDN reuse of a URL during its short validity period.
CREATE TABLE asset_request_budgets (
  bucket text PRIMARY KEY,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  byte_count bigint NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX asset_request_budgets_expiry_idx ON asset_request_budgets(expires_at);
