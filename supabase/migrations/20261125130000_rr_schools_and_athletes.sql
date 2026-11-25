-- RouteRunnr schools and shared athlete profiles (rr_schools, rr_athletes).
--
-- A school groups a coach's teams (e.g. JV and Varsity). An athlete is one
-- person at a school; `rr_players` rows remain the per-team, per-season roster
-- entries (jersey number, positions, active flag) and link to an athlete, so
-- the same person can appear on several teams and be recognized as such.
--
-- rr_players.name / graduation_year stay on the roster row as well: game_data
-- snapshots and every existing page read them from there. The app keeps them
-- in sync with the athlete when either is edited. Notes and positions are
-- per-team and live only on the roster row.

-- ---------- schools ----------

create table public.rr_schools (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create index rr_schools_owner_id_idx on public.rr_schools (owner_id);

alter table public.rr_schools enable row level security;

create policy "rr_schools: owner full access"
  on public.rr_schools
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------- teams.school_id ----------

alter table public.rr_teams
  add column school_id uuid references public.rr_schools (id) on delete set null;

create index rr_teams_school_id_idx on public.rr_teams (school_id);

-- ---------- rr_athletes ----------

create table public.rr_athletes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.rr_schools (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  graduation_year  int check (graduation_year between 1900 and 2200),
  created_at       timestamptz not null default now()
);

create index rr_athletes_school_id_idx on public.rr_athletes (school_id);

alter table public.rr_athletes enable row level security;

create policy "rr_athletes: school owner full access"
  on public.rr_athletes
  for all
  using (
    exists (
      select 1 from public.rr_schools s
      where s.id = rr_athletes.school_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.rr_schools s
      where s.id = rr_athletes.school_id and s.owner_id = auth.uid()
    )
  );

-- ---------- players.athlete_id ----------

alter table public.rr_players
  add column athlete_id uuid references public.rr_athletes (id) on delete set null;

create index rr_players_athlete_id_idx on public.rr_players (athlete_id);

-- A roster entry may only link to an athlete from its own team's school.
-- Without this, a crafted request could attach a player to an athlete at a
-- school the team doesn't belong to.
create or replace function public.rr_players_check_athlete_school()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.rr_teams t
    join public.rr_athletes a on a.school_id = t.school_id
    where t.id = new.team_id and a.id = new.athlete_id
  ) then
    raise exception 'athlete % does not belong to the school of team %',
      new.athlete_id, new.team_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rr_players_check_athlete_school
  before insert or update of athlete_id, team_id on public.rr_players
  for each row execute function public.rr_players_check_athlete_school();

-- Moving a team to a different school (or none) unlinks its roster entries,
-- since their athletes belong to the old school.
create or replace function public.rr_teams_unlink_players_on_school_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.school_id is distinct from old.school_id then
    update public.rr_players set athlete_id = null where team_id = new.id;
  end if;
  return new;
end;
$$;

create trigger rr_teams_unlink_players_on_school_change
  after update of school_id on public.rr_teams
  for each row execute function public.rr_teams_unlink_players_on_school_change();
