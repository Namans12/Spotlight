-- Preserve every legacy row. NULL source keys remain unknown and do not collide.
-- Old writers must be stopped while this migration and updated writers roll out.
ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_release_date_title_entry_type_key;
ALTER TABLE calendar_entries ADD COLUMN source_key TEXT;
ALTER TABLE calendar_entries ADD CONSTRAINT calendar_entries_source_identity UNIQUE (origin, source_key);

-- One digest slot can contain multiple release events for the same title.
ALTER TABLE release_items ADD COLUMN event_key TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE release_items DROP CONSTRAINT release_items_pkey;
ALTER TABLE release_items ADD PRIMARY KEY (tmdb_id, media_type, region, window_kind, section, event_key);
