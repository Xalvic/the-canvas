CREATE TABLE workspace_states (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  initialized_at timestamptz,
  last_opened_board_id uuid REFERENCES boards(id) ON DELETE SET NULL
);
CREATE INDEX workspace_states_last_board_idx ON workspace_states(last_opened_board_id)
  WHERE last_opened_board_id IS NOT NULL;

-- Compact identities have no expiry: an old retained intent must never become a
-- new initialization. No guest content or document snapshots are stored here.
CREATE TABLE workspace_initialization_receipts (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  create_initial_page boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, request_id)
);
