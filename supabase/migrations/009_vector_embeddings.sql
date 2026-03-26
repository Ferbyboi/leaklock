-- Enable pgvector extension (requires Supabase Pro or pgvector enabled project)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to field_notes and draft_invoices for semantic search
ALTER TABLE field_notes
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE draft_invoices
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- IVFFlat indexes for cosine similarity search
-- lists=100 is appropriate for tables up to ~1M rows
CREATE INDEX IF NOT EXISTS idx_field_notes_embedding
  ON field_notes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_draft_invoices_embedding
  ON draft_invoices USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
