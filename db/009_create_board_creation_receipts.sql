-- Replay is supported for 90 days. Compact identities remain indefinitely,
-- including after expiry/deletion, so a retained local intent cannot become a
-- fresh creation. Never delete these identities as ordinary receipt cleanup.
CREATE TABLE board_creation_receipts (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  board_id uuid REFERENCES boards(id) ON DELETE SET NULL,
  document_revision integer NOT NULL CHECK (document_revision = 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '90 days'),
  CHECK (expires_at > created_at),
  PRIMARY KEY (actor_id, request_id)
);
CREATE INDEX board_creation_receipts_board_idx ON board_creation_receipts (board_id) WHERE board_id IS NOT NULL;
