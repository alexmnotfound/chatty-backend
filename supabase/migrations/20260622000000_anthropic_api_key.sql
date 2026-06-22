-- Add Anthropic API key support and RLS to company_config

-- Nueva columna para Anthropic API key
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

-- RLS en company_config
ALTER TABLE company_config ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy for company_config
CREATE POLICY IF NOT EXISTS "tenant isolation" ON company_config
  FOR ALL USING (company_id IN (SELECT user_company_ids()));
