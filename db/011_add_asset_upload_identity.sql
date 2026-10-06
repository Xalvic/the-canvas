-- Additive: legacy uploads and completed assets keep their identity and bytes.
-- Retain these compact identities even after cleanup/deletion; never reuse a key.
ALTER TABLE board_assets
  ADD COLUMN upload_request_id uuid,
  ADD COLUMN upload_content_hash text,
  ADD COLUMN upload_lease_token uuid,
  ADD COLUMN upload_lease_until timestamptz,
  ADD COLUMN upload_attempts integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT board_assets_upload_identity_check CHECK (
    (upload_request_id IS NULL AND upload_content_hash IS NULL
      AND upload_lease_token IS NULL AND upload_lease_until IS NULL AND upload_attempts = 0)
    OR (upload_request_id IS NOT NULL AND upload_content_hash IS NOT NULL
      AND upload_content_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT board_assets_upload_attempts_check CHECK (upload_attempts BETWEEN 0 AND 3),
  ADD CONSTRAINT board_assets_upload_lease_check CHECK (upload_lease_token IS NULL OR upload_lease_until IS NOT NULL),
  ADD CONSTRAINT board_assets_upload_request_key UNIQUE (uploader_id, scope_board_id, upload_request_id);
