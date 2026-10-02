CREATE TABLE boards (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120 AND title = btrim(title)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at)
);
