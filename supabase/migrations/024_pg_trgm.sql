-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram indexes for job search
CREATE INDEX IF NOT EXISTS idx_jobs_crm_job_id_trgm
  ON jobs USING gin(crm_job_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_customer_name_trgm
  ON jobs USING gin(customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_address_trgm
  ON jobs USING gin(address gin_trgm_ops);

-- Search function (respects RLS via tenant_id filter)
CREATE OR REPLACE FUNCTION search_jobs(
  p_tenant_id uuid,
  p_query     text,
  p_limit     int DEFAULT 20
)
RETURNS TABLE (
  id            uuid,
  crm_job_id    text,
  customer_name text,
  address       text,
  status        text,
  created_at    timestamptz,
  similarity    real
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id,
    crm_job_id,
    customer_name,
    address,
    status,
    created_at,
    GREATEST(
      similarity(crm_job_id, p_query),
      similarity(customer_name, p_query),
      similarity(address, p_query)
    ) AS similarity
  FROM jobs
  WHERE
    tenant_id = p_tenant_id
    AND (
      crm_job_id    % p_query OR
      customer_name % p_query OR
      address       % p_query OR
      crm_job_id    ILIKE '%' || p_query || '%' OR
      customer_name ILIKE '%' || p_query || '%'
    )
  ORDER BY similarity DESC, created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_jobs TO authenticated;
