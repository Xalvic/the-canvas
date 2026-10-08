CREATE TABLE board_share_links (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  settings_version integer NOT NULL DEFAULT 0 CHECK (settings_version >= 0),
  token_hash text UNIQUE,
  token_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((enabled AND generation > 0 AND token_hash IS NOT NULL AND token_ciphertext IS NOT NULL
    AND token_hash ~ '^[a-f0-9]{64}$' AND token_ciphertext ~ '^[a-f0-9]{142}$')
    OR (NOT enabled AND token_hash IS NULL AND token_ciphertext IS NULL))
);

CREATE TABLE board_share_link_grants (
  board_id uuid NOT NULL REFERENCES board_share_links(board_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_share_link_grants_user_idx ON board_share_link_grants(user_id, board_id);

CREATE TABLE board_share_link_receipts (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  settings_version integer NOT NULL CHECK (settings_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (board_id, actor_id, request_id)
);
CREATE INDEX board_share_link_receipts_actor_created_idx ON board_share_link_receipts(actor_id, created_at);
