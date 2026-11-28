-- One stream overlay link per team.
--
-- The camera operator sets the team's link in Mevo/OBS once; it shows
-- whichever game the team is scoring right now, so the scorer and the camera
-- operator never have to swap per-game links. Game links keep working.
--
-- Team link resolution:
--   1. the team's in-progress game (most recently saved, if more than one);
--   2. else a game finished in the last 6 hours (shows FINAL);
--   3. else no game: has_game = false and the overlay draws nothing.

alter table public.rr_teams
  add column overlay_token uuid not null default gen_random_uuid();
-- gen_random_uuid() is volatile, so each existing team gets its own token.
create unique index rr_teams_overlay_token_key on public.rr_teams (overlay_token);

-- The return type gains has_game, so the function is dropped and recreated.
drop function public.rr_get_overlay_scoreboard(uuid);

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
  awaiting_ot_conversion   boolean,
  has_game                 boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_team_name text;
  v_game public.rr_games%rowtype;
begin
  -- A game's own link.
  select g.* into v_game from public.rr_games g where g.overlay_token = p_token;
  if found then
    v_team_id := v_game.team_id;
  else
    -- A team link: follow the game being scored.
    select t.id into v_team_id from public.rr_teams t where t.overlay_token = p_token;
    if v_team_id is null then
      return;
    end if;
    select g.* into v_game
      from public.rr_games g
     where g.team_id = v_team_id
       and (g.status = 'in_progress'
            or (g.status = 'completed' and g.updated_at > now() - interval '6 hours'))
     order by (g.status = 'in_progress') desc, g.updated_at desc
     limit 1;
  end if;

  select t.name into v_team_name from public.rr_teams t where t.id = v_team_id;

  if v_game.id is null then
    return query select v_team_name, null::text, 0, 0, null::text, null::text, 0, 1, 0, 0, 0, false, false, false;
    return;
  end if;

  return query select
    v_team_name,
    v_game.opponent_name,
    coalesce((v_game.game_data -> 'score' ->> 'team')::int, 0),
    coalesce((v_game.game_data -> 'score' ->> 'opponent')::int, 0),
    v_game.game_data ->> 'possession',
    v_game.game_data ->> 'half',
    coalesce((v_game.game_data ->> 'overtimeRound')::int, 0),
    coalesce((v_game.game_data ->> 'down')::int, 1),
    coalesce((v_game.game_data ->> 'yardsToGo')::int, 0),
    coalesce((v_game.game_data ->> 'lineOfScrimmage')::int, 0),
    coalesce((v_game.game_data ->> 'firstDownTarget')::int, 0),
    coalesce((v_game.game_data ->> 'completed')::boolean, false),
    coalesce((v_game.game_data ->> 'awaitingOvertimeConversion')::boolean, false),
    true;
end;
$$;

revoke all on function public.rr_get_overlay_scoreboard(uuid) from public;
grant execute on function public.rr_get_overlay_scoreboard(uuid) to anon, authenticated;
