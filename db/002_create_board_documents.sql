CREATE TABLE board_documents (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  schema_version integer NOT NULL
    CONSTRAINT board_documents_schema_version_positive CHECK (schema_version > 0),
  revision integer NOT NULL
    CONSTRAINT board_documents_revision_positive CHECK (revision > 0),
  content jsonb NOT NULL
    CONSTRAINT board_documents_content_shape CHECK (
      (jsonb_typeof(content) = 'object'
        AND jsonb_typeof(content -> 'objects') = 'array') IS TRUE
    ),
  updated_at timestamptz NOT NULL DEFAULT now()
);
