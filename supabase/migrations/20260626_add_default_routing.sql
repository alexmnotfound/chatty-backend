ALTER TABLE company_config
  ADD COLUMN IF NOT EXISTS default_routing TEXT NOT NULL DEFAULT 'ai'
    CHECK (default_routing IN ('ai', 'human'));
