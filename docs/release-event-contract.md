# Release-event contract

This document defines the target contract and the current implementation. Historical rows without provenance remain unknown.

## Event identity and evidence

A release event describes one title (`media_type`, TMDB ID, or an explicitly unresolved identity), territory, event kind, date and precision, and, when known, season/episode and provider. A title can have multiple events. A provider availability observation is distinct from a release-date observation. Each observation needs its source, source URL where available, territory and observation time; inference, conflicting observations, missing fields and uncertain dates must remain distinguishable. Global first-air dates, production networks and foreign availability do not establish a regional streaming date or regional availability. A regional digital date is not proof that a particular provider first offered the title on that date.

The current `release_items` table is a rolling digest snapshot, not an event history. Its existing rows lack this provenance. Do not backfill evidence by assuming a row's digest region is the source region. New digest rows persist regional TMDB evidence, observation time, event kind, date precision and source URL; theatrical calendar rows persist corresponding regional evidence. Provider categories, complete event identity, reconciliation and UI labels remain future work. Existing consumers and scheduled jobs must be migrated compatibly; legacy evidence remains unknown until independently verified.

## Window contract

Out Now covers the inclusive `start` and `end` dates recorded in the digest; Coming Up covers its own inclusive bounds. Dates outside those windows are not members of either window. News augmentation is bounded to the combined horizon. The releases API also filters older stored rows against their recorded bounds during the transition. This can make the feed smaller and does not repair old database records. The window may include a future date; membership alone does not mean that date has arrived.

## Watchlist alert eligibility

An alert is permitted only when the item's valid date is inside Out Now and is no later than the digest's local generation date; evidence from the same run must establish both a TMDB digital date for the digest region and a current TMDB provider listing for that region. The provider list must be nonempty. Missing, foreign, inferred, unrecognized or malformed evidence fails closed. Evidence must have a timezone-aware observation time within 24 hours of the digest run (allowing five minutes of clock skew). A current listing and a regional digital date do not prove the provider's own launch date; copy must not make that stronger claim. Account opt-in and existing per-user/channel deduplication still apply.

Only movie ingestion currently captures the evidence required by this rule. TV alerts, fallback-only titles and release items constructed without evidence will not be sent. No catch-up delivery is implemented: because sending is scheduled, an eligible release dated between send runs may be missed. Improving cadence or a separately bounded catch-up policy requires its own design and tests. Evidence is persisted in nullable JSONB columns and returned for eligible digest entries; with its observation time, region and known provider types displayed. Unknown fields remain labelled unknown. Existing legacy TMDB calendar rows without regional theatrical evidence are hidden until refreshed. Editorial calendar entries have not been individually reverified. The regional digest excludes TV until a regional OTT date source exists, and date/provider coverage can decrease substantially.

## Deployment sequence

Apply `migrations/0017_release_evidence.sql` before deploying readers, writers or scheduled jobs that use the evidence columns. Legacy rows stay NULL and are not treated as verified. After deployment, refresh the digest and calendar through the normal jobs; audit results before relying on coverage. No production migration or refresh was performed as part of this implementation.

## Calendar identity and current storage limit

The opt-in `scripts/recheck_calendar_evidence.py` checks upcoming legacy TMDB movie rows against current TMDB theatrical dates for a specified region. It only adds evidence if the stored ID, source URL, movie/theatrical classification and exact regional date all agree; it leaves existing evidence and rows already represented by a verified event untouched. It does not infer a region for TV, editorial, Wikipedia or ticketing records. The script is dry-run by default, processes at most 200 rows, and aborts without writes on an upstream outage. The manually dispatched `Calendar evidence recheck` workflow runs the bounded India recheck with writes enabled. A mismatch stays unverified and is not an assertion that the release is unavailable.

The calendar merges only records sharing a known region, media type, TMDB ID, date, release kind and season/part marker. Unknown identity or region stays separate, and unknown regions are labelled in the UI. Multiple providers from observations of the same event are retained. Country filtering applies to known regions; source rows with unknown regions are still included and explicitly labelled unknown. Existing editorial source claims have not been independently checked.

Migration `0018_event_identity.sql` replaces the calendar title/date constraint with a nullable source-record identity. Each writer assigns a source-specific key; historical rows retain null keys rather than being guessed into a match. Digest rows add an event key for release kind, date and season. Existing legacy rows remain intact. A source without a reliable ID uses a fingerprint of the source record; upstream edits can produce conservative duplicates. The calendar-overlap diagnostic is read-only because a shared title and date alone do not prove a duplicate.

## Identity migration rollout

Stop scheduled and manual writers before applying migrations 0017 and 0018 in order. Deploy all updated writers and readers together, then resume jobs: old writers use conflict targets removed by migration 0018 and will fail against the new schema. Validate row counts and new source identities in staging first. The first refresh can add rows alongside unkeyed legacy records; do not delete those records without independent event-level reconciliation. The digest remains a rolling snapshot, not a release history. No production migration was applied during development.

## Watch-order trust

Uncurated TMDB collections and unlisted new members produce related-title links with unverified order, not mandatory prerequisites. Curated arcs remain supported. The UI and agent report unknown order rather than claiming a title stands alone. Migration 0019 clears unsuppressed machine-generated TMDB and Wikidata edges and their lookup cache for regeneration; curated source edges and global and per-user suppressions remain. Stop old writers, apply 0017–0019, deploy the new code and resume regeneration together. None of these migrations has been applied to production.
