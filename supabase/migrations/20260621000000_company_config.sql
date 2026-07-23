-- Baseline migration capturing the real remote schema of company_config.
-- This table was created directly against the remote project outside the
-- migration history (schema drift discovered while building the receipt
-- analyzer feature). `IF NOT EXISTS` makes this a no-op on the remote
-- project, where the table already exists; it fills the gap for local
-- `supabase db reset` and any future environment built from scratch.
CREATE TABLE IF NOT EXISTS "public"."company_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "whatsapp_phone_number_id" "text",
    "whatsapp_access_token" "text",
    "whatsapp_app_secret" "text",
    "open_ai_api_key" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "whatsapp_phone_number" "text",
    "whatsapp_token_expired" boolean DEFAULT false NOT NULL,
    "default_routing" "text" DEFAULT 'ai'::"text" NOT NULL,
    "company_name" "text",
    "company_hours" "text",
    "company_address" "text",
    "company_services" "text",
    "company_contact" "text",
    CONSTRAINT "company_config_default_routing_check" CHECK (("default_routing" = ANY (ARRAY['ai'::"text", 'human'::"text"])))
);

ALTER TABLE ONLY "public"."company_config"
    ADD CONSTRAINT "company_config_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."company_config"
    ADD CONSTRAINT "company_config_company_id_key" UNIQUE ("company_id");

ALTER TABLE ONLY "public"."company_config"
    ADD CONSTRAINT "company_config_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;
