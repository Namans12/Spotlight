-- Preserve observed evidence without inventing provenance for legacy snapshots.
-- Deploy this migration before the writer and readers that require this column.
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS evidence JSONB;

ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS evidence JSONB;
