-- P0-5 (TRD G2, G3): relay bookkeeping and dead-letter store for platform.outbox.
-- Rows already pending become due immediately (next_attempt_at defaults to now()).
ALTER TABLE platform.outbox
  ADD COLUMN attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error      text;

-- An event that keeps failing is moved here (and removed from platform.outbox), so the
-- pending index stays small. It keeps name/payload/occurred_at so it can be inspected and
-- replayed. These three columns go beyond the Schema doc's list (outbox_id, attempts,
-- last_error, failed_at) because the source row is deleted.
CREATE TABLE platform.outbox_dead_letter (
  outbox_id   uuid        PRIMARY KEY,
  name        text        NOT NULL,
  payload     jsonb       NOT NULL,
  occurred_at timestamptz NOT NULL,
  attempts    integer     NOT NULL,
  last_error  text,
  failed_at   timestamptz NOT NULL DEFAULT now()
);