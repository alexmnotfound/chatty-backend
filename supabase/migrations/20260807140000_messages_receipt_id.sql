alter table messages
  add column if not exists receipt_id uuid references receipts(id);
