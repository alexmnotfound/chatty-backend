-- Create company_config table
CREATE TABLE company_config (
  company_id UUID PRIMARY KEY,
  whatsapp_phone_number TEXT,
  anthropic_api_key TEXT,
  company_name TEXT,
  company_hours TEXT,
  company_address TEXT,
  company_services TEXT,
  company_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT company_config_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
