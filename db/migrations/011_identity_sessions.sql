-- Login sessions (opaque tokens) and the record of login attempts (ADR 0006).
-- Only a SHA-256 hash of a session token is stored, never the token itself.
-- device_id (Schema doc) arrives with the device tables, as a nullable column.

CREATE TABLE IF NOT EXISTS identity.session (
  id         uuid PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES identity.user_account (id),
  token_hash text        NOT NULL,
  issued_at  timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT session_token_hash_key UNIQUE (token_hash),
  CONSTRAINT session_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT session_lifetime CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS session_user_idx ON identity.session (user_id);

-- One row per login (or password-confirmation) attempt that actually checked a password.
-- Rows are never modified. username is lower-cased and cut to 100 characters, and may name a
-- user that does not exist.
CREATE TABLE IF NOT EXISTS identity.login_attempt (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text        NOT NULL,
  ip       text,
  success  boolean     NOT NULL,
  at       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempt_username_idx ON identity.login_attempt (username, at);
CREATE INDEX IF NOT EXISTS login_attempt_ip_idx ON identity.login_attempt (ip, at) WHERE NOT success;

CREATE OR REPLACE FUNCTION identity.forbid_login_attempt_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'login attempts are never modified'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

DROP TRIGGER IF EXISTS login_attempt_no_update ON identity.login_attempt;
CREATE TRIGGER login_attempt_no_update
  BEFORE UPDATE ON identity.login_attempt
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_login_attempt_update();