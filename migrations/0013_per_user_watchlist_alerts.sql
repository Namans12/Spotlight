-- Spotlight migration 0013: watchlist-drop alerts for every account, not just
-- the owner's.
--
-- The alert pipeline already exists and works (releasebot.py
-- find_watchlist_matches / send_watchlist_alerts). It has only ever notified
-- one person: the matcher is scoped by NOTIFY_OWNER_EMAILS, the recipient is
-- the single EMAIL_TO address, and — the part that actually blocks this —
-- sent_notifications is unique per title *globally* rather than per person.
--
-- That last one is not a configuration limit but a data-model one. With
-- UNIQUE (tmdb_id, media_type, notification_kind, channel), the first account
-- alerted about a film consumes the only row that will ever exist for it, and
-- every other account is silently skipped forever. Widening the scope without
-- widening this key would make the feature look like it worked while
-- delivering exactly one alert per title across the whole user base.

BEGIN;

-- 1. Opt-in, per account.
--
-- Defaults to false, deliberately. This sends email to a real address, and an
-- account that never asked for it must not start receiving mail because a
-- migration ran — including the accounts that already exist. Turning it on is
-- a deliberate act in the UI.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notify_watchlist_drops BOOLEAN NOT NULL DEFAULT false;

-- 2. Who each alert was for.
--
-- Nullable, because the rows already in this table were sent to the owner
-- through the env-configured channels and belong to no account. ON DELETE
-- CASCADE so deleting an account takes its notification history with it,
-- matching every other per-user table (migrations/0007).
ALTER TABLE sent_notifications
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- 3. Re-key the dedupe on (title, kind, channel, person).
--
-- The old constraint's name is whatever Postgres generated for the inline
-- UNIQUE in 0001; look it up rather than guessing at it.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'sent_notifications'::regclass
      AND contype = 'u';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE sent_notifications DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

-- COALESCE rather than a plain multi-column unique, because Postgres treats
-- NULLs as distinct in a unique constraint: with a bare `user_id` column, every
-- legacy owner row (user_id IS NULL) would compare unequal to every other one
-- and the owner would be re-alerted about the same title on every single run.
-- Folding NULL to 0 keeps those rows deduping exactly as they did before.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_notifications_unique
    ON sent_notifications (tmdb_id, media_type, notification_kind, channel, COALESCE(user_id, 0));

-- The per-user send loop asks "what has this account already been told about?"
-- once per user per run.
CREATE INDEX IF NOT EXISTS idx_sent_notifications_user
    ON sent_notifications (user_id)
    WHERE user_id IS NOT NULL;

COMMIT;
