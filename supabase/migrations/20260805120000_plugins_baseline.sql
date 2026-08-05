-- Baseline migration capturing the real remote schema of plugins/company_plugins.
-- These tables were created directly against the remote project outside the
-- migration history (same class of drift as company_config, see
-- 20260621000000_company_config.sql). Column list confirmed read-only via the
-- PostgREST OpenAPI introspection endpoint (GET /rest/v1/), not guessed —
-- direct `supabase db dump --linked` was unavailable in this environment
-- (the project's direct-connection host is IPv6-only; verified via
-- `supabase db query --linked` instead, which goes through the Management
-- API over HTTPS). Every statement is guarded to be a true no-op against the
-- remote project where these tables already exist.
create table if not exists plugins (
    id uuid default gen_random_uuid() not null,
    name text not null,
    slug text not null,
    description text,
    icon text,
    price_usd numeric default 0 not null,
    active boolean default true not null,
    created_at timestamptz default now() not null
);

create table if not exists company_plugins (
    id uuid default gen_random_uuid() not null,
    company_id uuid not null,
    plugin_id uuid not null,
    assigned_at timestamptz default now() not null,
    assigned_by text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plugins_pkey') then
    alter table only plugins add constraint plugins_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plugins_slug_key') then
    alter table only plugins add constraint plugins_slug_key unique (slug);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_plugins_pkey') then
    alter table only company_plugins add constraint company_plugins_pkey primary key (id);
  end if;
  -- superCompanies.ts's POST /:id/plugins handles a 23505 (unique_violation)
  -- on assignment, confirming a real unique constraint on this pair exists
  -- remotely; name inferred from Postgres's default naming convention.
  if not exists (select 1 from pg_constraint where conname = 'company_plugins_company_id_plugin_id_key') then
    alter table only company_plugins add constraint company_plugins_company_id_plugin_id_key unique (company_id, plugin_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_plugins_company_id_fkey') then
    alter table only company_plugins add constraint company_plugins_company_id_fkey
      foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_plugins_plugin_id_fkey') then
    alter table only company_plugins add constraint company_plugins_plugin_id_fkey
      foreign key (plugin_id) references plugins(id) on delete cascade;
  end if;
end $$;
