create table receipts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  message_id       text not null,
  storage_path     text not null,
  mime_type        text not null,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente', 'revisado', 'exportado', 'error')),
  extracted        jsonb not null default '{}'::jsonb,
  export_error     text,
  exported_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index on receipts (company_id, estado);
create index on receipts (company_id, created_at desc);

create table sheets_config (
  company_id      uuid primary key,
  spreadsheet_id  text not null,
  sheet_name      text not null default 'Comprobantes',
  sa_key_enc      text not null,
  auto_export     boolean not null default false,
  updated_at      timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
