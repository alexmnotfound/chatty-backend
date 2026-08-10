create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  operador_id uuid not null references company_members(id),
  pesos_cliente numeric not null,
  tipo_cambio_cliente numeric not null,
  usd_cliente numeric not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'vinculada', 'cancelada')),
  receipt_id uuid references receipts(id),
  operador2_id uuid references company_members(id),
  pesos_proveedor numeric,
  tipo_cambio_proveedor numeric,
  moneda_final text check (moneda_final in ('USD', 'USDT')),
  monto_final numeric,
  link_error text,
  created_at timestamptz not null default now(),
  linked_at timestamptz
);

create index if not exists operations_company_estado_idx on operations (company_id, estado);

alter table sheets_config
  add column if not exists operations_sheet_name text;
