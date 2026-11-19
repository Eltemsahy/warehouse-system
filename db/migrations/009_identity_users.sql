-- P1-1 step 1: user accounts and their password credentials (Schema doc, identity).
-- A username is unique ignoring case and never changes (audit trails refer to the user id, but
-- people read usernames). An email is optional, and unique ignoring case when present. The
-- password hash lives in its own table, so it is never selected by accident with the account.
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.user_account (
  id            uuid        PRIMARY KEY,
  username      text        NOT NULL,
  email         text,
  display_name  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'ACTIVE',
  locale        text        NOT NULL DEFAULT 'en',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT user_username_format CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$'),
  CONSTRAINT user_email_format CHECK (
    email IS NULL
    OR (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  CONSTRAINT user_status_chk CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT user_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT user_locale_format CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
CREATE UNIQUE INDEX user_username_key ON identity.user_account (lower(username));
CREATE UNIQUE INDEX user_email_key ON identity.user_account (lower(email));

CREATE TABLE identity.credential (
  user_id        uuid        PRIMARY KEY REFERENCES identity.user_account (id),
  -- Self-describing string, for example scrypt$65536$8$2$<salt>$<hash>.
  password_hash  text        NOT NULL,
  algorithm      text        NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION identity.forbid_username_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'a username is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER user_username_immutable BEFORE UPDATE ON identity.user_account
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_username_change();