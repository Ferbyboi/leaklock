-- Ensure reconciliation_results.run_at defaults to now() so inserts
-- without an explicit value get timestamped automatically.
ALTER TABLE reconciliation_results
  ALTER COLUMN run_at SET DEFAULT now();

-- Ensure field_notes.parsed_at defaults to now()
ALTER TABLE field_notes
  ALTER COLUMN parsed_at SET DEFAULT now();
