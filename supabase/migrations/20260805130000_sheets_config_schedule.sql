alter table sheets_config
  add column if not exists schedule_type text check (schedule_type in ('interval', 'days')) default 'interval',
  add column if not exists interval_hours int default 6,
  add column if not exists schedule_days int[] default '{0,1,2,3,4}',
  add column if not exists schedule_time text default '09:00',
  add column if not exists last_auto_export_at timestamptz;
