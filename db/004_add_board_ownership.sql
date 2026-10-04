-- Preserve legacy proof boards without assigning them to an arbitrary account.
-- NULL owners are quarantined: application queries always require an owner ID.
ALTER TABLE boards ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX boards_owner_created_idx ON boards(owner_id, created_at, id)
  WHERE owner_id IS NOT NULL;
