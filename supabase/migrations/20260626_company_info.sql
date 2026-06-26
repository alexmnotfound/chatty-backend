alter table company_config
  add column if not exists company_name    text,
  add column if not exists company_hours   text,
  add column if not exists company_address text,
  add column if not exists company_services text,
  add column if not exists company_contact text;
