-- P0-7 (TRD s5.5, Schema doc: platform.idempotency_key).
-- One row per (Idempotency-Key, caller). The row is claimed before the request runs
-- (response_status IS NULL = in progress) and completed with the response afterwards.
CREATE TABLE platform.idempotency_key (
  key             text        NOT NULL,
  -- Caller identity. 'anonymous' until the identity module provides real user ids.
  user_id         text        NOT NULL,
  -- sha256 of method + url + canonical body; detects a key reused for a different request.
  request_hash    text        NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (key, user_id)
);

CREATE INDEX idempotency_key_expires_idx ON platform.idempotency_key (expires_at);