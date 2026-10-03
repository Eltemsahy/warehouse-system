CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.outbox (
  id           uuid PRIMARY KEY,
  name         text        NOT NULL,
  payload      jsonb       NOT NULL,
  occurred_at  timestamptz NOT NULL,
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON platform.outbox (occurred_at) WHERE published_at IS NULL;
