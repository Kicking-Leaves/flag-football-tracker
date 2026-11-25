-- Prefix every RouteRunnr object with rr_.
--
-- This Supabase project is shared with PeakSeason, which owns tables such as
-- athletes, sports and user_profiles. RouteRunnr's generic names (teams,
-- seasons, players, games) are renamed so the two apps can't collide.
--
-- RENAME keeps data, foreign keys, RLS policies, triggers and indexes attached.
-- What it does NOT fix is function bodies that name a table as text, so the
-- first step refuses to run if any function other than ours still refers to
-- the old names.

-- ---------- safety check ----------

do $$
declare
  offenders text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into offenders
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname <> 'get_overlay_scoreboard'  -- recreated below
    and p.prosrc ~* '\m(public\.)?(teams|seasons|players|games)\M';
  if offenders is not null then
    raise exception 'These functions refer to RouteRunnr tables by name and would break after the rename: %', offenders;
  end if;
end;
$$;

-- ---------- tables ----------

alter table public.teams   rename to rr_teams;
alter table public.seasons rename to rr_seasons;
alter table public.players rename to rr_players;
alter table public.games   rename to rr_games;

-- ---------- constraints and indexes ----------
-- e.g. teams_pkey -> rr_teams_pkey, games_overlay_token_key -> rr_games_overlay_token_key.

do $$
declare
  r record;
begin
  -- Constraints first; renaming a primary key or unique constraint renames its
  -- index too.
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('rr_teams', 'rr_seasons', 'rr_players', 'rr_games')
      and c.conname !~ '^rr_'
  loop
    execute format('alter table public.%I rename constraint %I to %I',
                   r.relname, r.conname, 'rr_' || r.conname);
  end loop;

  for r in
    select i.relname as idx
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('rr_teams', 'rr_seasons', 'rr_players', 'rr_games')
      and i.relname !~ '^rr_'
  loop
    execute format('alter index public.%I rename to %I', r.idx, 'rr_' || r.idx);
  end loop;
end;
$$;

-- ---------- overlay function ----------

drop function if exists public.get_overlay_scoreboard(uuid);

create function public.rr_get_overlay_scoreboard(p_token uuid)
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
  from public.rr_games g
  join public.rr_teams t on t.id = g.team_id
  where g.overlay_token = p_token;
$$;

revoke all on function public.rr_get_overlay_scoreboard(uuid) from public;
grant execute on function public.rr_get_overlay_scoreboard(uuid) to anon, authenticated;
