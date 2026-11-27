-- Game type: scrimmage, regular season or postseason.
-- Scrimmages don't count toward season stats or the season record; regular
-- season and postseason games both do. Existing games become regular season.
--
-- Shared database: rr_ prefix, no "if not exists".

alter table public.rr_games
  add column game_type text not null default 'regular'
  constraint rr_games_game_type_check check (game_type in ('scrimmage', 'regular', 'postseason'));
