-- Games can be created ahead of time and started later ("scheduled").
-- Shared database: rr_ prefix only.

alter table public.rr_games drop constraint rr_games_status_check;
alter table public.rr_games
  add constraint rr_games_status_check check (status in ('scheduled', 'in_progress', 'completed'));
