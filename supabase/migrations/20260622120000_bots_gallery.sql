-- backend/supabase/migrations/20260622120000_bots_gallery.sql

ALTER TABLE bots ADD COLUMN IF NOT EXISTS template_type text;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN bots.template_type IS 'recepcionista | comercial | null (no template)';
COMMENT ON COLUMN bots.is_active IS 'Company-admin controlled toggle. Distinct from super-admin active field.';
