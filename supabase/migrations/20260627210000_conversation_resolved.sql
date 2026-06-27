-- Add resolved_by to track who resolved the conversation (bot or human agent)
alter table conversations add column if not exists resolved_by text check (resolved_by in ('bot', 'human'));
