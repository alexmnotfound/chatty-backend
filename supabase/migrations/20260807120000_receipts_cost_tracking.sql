alter table receipts
  add column if not exists ai_model text,
  add column if not exists tokens_in int,
  add column if not exists tokens_out int,
  add column if not exists cost_usd numeric;
