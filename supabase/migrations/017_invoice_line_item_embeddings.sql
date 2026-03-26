-- Migration 017: invoice_line_item_embeddings
-- Stores per-line-item vector embeddings for semantic similarity search.
-- Enables the vector_similarity_match() fallback in match_engine.py when
-- fuzzy token-overlap score is below 0.7.

-- ── 1. Enable pgvector extension ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_line_item_embeddings (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id          uuid        NOT NULL REFERENCES jobs(id)    ON DELETE CASCADE,
    line_item_text  text        NOT NULL,
    -- voyage-3 produces 1024-dimensional vectors; we store as 1536 to leave
    -- room for model upgrades. Actual dimension set at insert time via the
    -- generate_embeddings Celery task (tasks.py).
    embedding       vector(1536),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE invoice_line_item_embeddings ENABLE ROW LEVEL SECURITY;

-- Tenants can only read/write their own embeddings.
-- Service-role (Celery workers) bypasses RLS by design.
CREATE POLICY "tenant_isolation" ON invoice_line_item_embeddings
    USING (tenant_id = auth.uid());

-- ── 4. IVFFlat index for fast cosine ANN search ───────────────────────────────
-- lists=100 is a reasonable default for up to ~1M rows per tenant.
-- Re-index with a higher lists value if the table grows beyond 10M rows.
CREATE INDEX IF NOT EXISTS idx_ile_embedding_cosine
    ON invoice_line_item_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Compound index to speed up tenant-scoped queries (WHERE tenant_id = ?)
CREATE INDEX IF NOT EXISTS idx_ile_tenant_job
    ON invoice_line_item_embeddings (tenant_id, job_id);

-- ── 5. Helper RPC function (used by vector_similarity_match in match_engine.py)
-- Runs the parameterised pgvector cosine similarity query.
-- Called via: db.rpc("match_invoice_line_items", {...})
CREATE OR REPLACE FUNCTION match_invoice_line_items(
    query_vector    vector(1536),
    p_tenant_id     uuid,
    p_threshold     float DEFAULT 0.85
)
RETURNS TABLE (
    id              uuid,
    job_id          uuid,
    tenant_id       uuid,
    line_item_text  text,
    similarity      float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        id,
        job_id,
        tenant_id,
        line_item_text,
        1 - (embedding <=> query_vector) AS similarity
    FROM  invoice_line_item_embeddings
    WHERE tenant_id = p_tenant_id
      AND 1 - (embedding <=> query_vector) > p_threshold
    ORDER BY similarity DESC
    LIMIT 10;
$$;
