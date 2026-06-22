-- Add real phone number field to company_config (non-secret, displayed in UI)
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT;
