alter table sheets_config
  drop column if exists sheet_name,
  drop column if exists auto_export,
  drop column if exists schedule_type,
  drop column if exists interval_hours,
  drop column if exists schedule_days,
  drop column if exists schedule_time,
  drop column if exists last_auto_export_at;
