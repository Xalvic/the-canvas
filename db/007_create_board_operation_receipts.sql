-- Kept with the board so a lost response can be replayed safely even after
-- subsequent edits or an application restart. No canvas content is duplicated.
CREATE TABLE board_operation_receipts (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  applied_revision integer NOT NULL CHECK (applied_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (board_id, actor_id, operation_id)
);
CREATE INDEX board_operation_receipts_actor_created_idx ON board_operation_receipts (actor_id, created_at);
