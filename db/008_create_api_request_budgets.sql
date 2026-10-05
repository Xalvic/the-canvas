-- Fixed-window, expiring admission budgets. Only HMAC identifiers are stored.
CREATE TABLE api_request_budgets (
  bucket text PRIMARY KEY CHECK (bucket ~ '^[0-9a-f]{64}$'),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX api_request_budgets_expiry_idx ON api_request_budgets(expires_at);
