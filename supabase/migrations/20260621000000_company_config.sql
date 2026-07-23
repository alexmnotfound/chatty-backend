-- Baseline migration capturing the real remote schema of company_config.
-- This table was created directly against the remote project outside the
-- migration history (schema drift discovered while building the receipt
-- analyzer feature). Column list pulled read-only via `supabase db dump
-- --linked` against the live project, not guessed.
--
-- Every statement below is guarded to be a true no-op against that remote
-- project (where the table and its constraints already exist), while still
-- building the table from scratch on a fresh local `supabase db reset`.
--
-- Note: the company_id -> companies FK here predates and is exempt from
-- this codebase's later "no FK to companies, app-level scoping only"
-- convention (see other tables in this migration set) — it's a baseline
-- capture of pre-existing remote structure, not a new design choice.
create table if not exists company_config (
    id uuid default gen_random_uuid() not null,
    company_id uuid not null,
    whatsapp_phone_number_id text,
    whatsapp_access_token text,
    whatsapp_app_secret text,
    open_ai_api_key text,
    updated_at timestamptz default now() not null,
    whatsapp_phone_number text,
    whatsapp_token_expired boolean default false not null,
    default_routing text default 'ai' not null,
    company_name text,
    company_hours text,
    company_address text,
    company_services text,
    company_contact text,
    constraint company_config_default_routing_check check (default_routing in ('ai', 'human'))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_config_pkey'
  ) then
    alter table only company_config
      add constraint company_config_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_config_company_id_key'
  ) then
    alter table only company_config
      add constraint company_config_company_id_key unique (company_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_config_company_id_fkey'
  ) then
    alter table only company_config
      add constraint company_config_company_id_fkey
      foreign key (company_id) references companies(id) on delete cascade;
  end if;
end $$;
