-- Migration 025: Add archival columns to field_notes for S3 lifecycle
-- Supports the archive-voice-recordings Edge Function which moves
-- voice recordings older than 90 days from Supabase Storage → AWS S3 GLACIER_IR.

ALTER TABLE field_notes
  ADD COLUMN IF NOT EXISTS audio_archive_url text,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz;

-- Index for the archival job: quickly find old, unarchived notes with audio.
-- Partial index keeps it lean — only rows that need processing are indexed.
CREATE INDEX IF NOT EXISTS idx_field_notes_archival
  ON field_notes (created_at, audio_url)
  WHERE audio_url IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN field_notes.audio_archive_url IS
  'S3 URI after archival (e.g. s3://bucket/voice-archive/<tenant_id>/<job_id>/<note_id>.webm). '
  'Populated by the archive-voice-recordings Edge Function once audio_url is nulled out.';

COMMENT ON COLUMN field_notes.archived_at IS
  'Timestamp when the recording was moved to S3 GLACIER_IR cold storage. '
  'NULL means the recording is still live in Supabase Storage.';
