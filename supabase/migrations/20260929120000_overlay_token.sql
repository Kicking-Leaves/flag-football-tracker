-- Public, read-only scoreboard overlay access for live streaming.
--
-- A stream overlay is consumed by software that cannot log in (Mevo Studio
-- browser sources, OBS browser sources). Rather than widening RLS or shipping
-- a service-role key, each game gets an unguessable token and a narrow
-- SECURITY DEFINER projection. The token lookup in the function body IS the
-- authorization check.
--
-- The projection deliberately excludes plays, playerStats, and roster: a
-- leaked overlay token exposes the scoreboard and nothing else.

alter table public.games
  add column overlay_token uuid not null default gen_random_uuid();

-- gen_random_uuid() is volatile, so the ALTER above evaluates it per row and
-- existing games each get a distinct token. No backfill needed.
create unique index games_overlay_token_key
  on public.games (overlay_token);

create or replace function public.get_overlay_scoreboard(p_token uuid)
returns table (
  team_name                text,
  opponent_name            text,
  team_score               int,
  opponent_score           int,
  possession               text,
  half                     text,
  overtime_round           int,
  down                     int,
  yards_to_go              int,
  line_of_scrimmage        int,
  first_down_target        int,
  completed                boolean,
  awaiting_ot_conversion   boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    t.name,
    g.opponent_name,
    coalesce((g.game_data -> 'score' ->> 'team')::int, 0),
    coalesce((g.game_data -> 'score' ->> 'opponent')::int, 0),
    g.game_data ->> 'possession',
    g.game_data ->> 'half',
    coalesce((g.game_data ->> 'overtimeRound')::int, 0),
    coalesce((g.game_data ->> 'down')::int, 1),
    coalesce((g.game_data ->> 'yardsToGo')::int, 0),
    coalesce((g.game_data ->> 'lineOfScrimmage')::int, 0),
    coalesce((g.game_data ->> 'firstDownTarget')::int, 0),
    coalesce((g.game_data ->> 'completed')::boolean, false),
    coalesce((g.game_data ->> 'awaitingOvertimeConversion')::boolean, false)
  from public.games g
  join public.teams t on t.id = g.team_id
  where g.overlay_token = p_token;
$$;

-- Supabase grants EXECUTE on new functions broadly by default; narrow it so
-- only the intended roles can call this.
revoke all on function public.get_overlay_scoreboard(uuid) from public;
grant execute on function public.get_overlay_scoreboard(uuid) to anon, authenticated;
