-- Film review, part 1: camera recordings imported per game.
--
-- One row per camera per game. The film worker (Cloud Run job, service role)
-- copies the file from Google Drive into Cloud Storage, makes a 720p review
-- copy and fills in the recording details. Video bytes never touch Supabase:
-- only storage paths are kept here.
--
-- Shared database: everything is prefixed rr_ and created without
-- "if not exists" so a clash fails loudly instead of reusing another app's table.

create table public.rr_film_cameras (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.rr_games(id) on delete cascade,
  -- Copied from the game by trigger so access rules don't need a join.
  team_id uuid not null references public.rr_teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position smallint not null default 0,

  -- Where it came from.
  source text not null default 'drive' check (source in ('drive', 'upload')),
  drive_file_id text,
  source_name text,
  size_bytes bigint,

  -- Cloud Storage object paths (within the film bucket).
  original_path text,
  proxy_path text,
  thumb_path text,

  status text not null default 'queued'
    check (status in ('queued', 'importing', 'processing', 'ready', 'failed')),
  -- 0-100 within the current status, for progress bars.
  progress smallint not null default 0 check (progress between 0 and 100),
  error text,
  -- Cloud Run execution name of the latest job, for debugging.
  job_execution text,

  -- Recording details read from the file.
  recorded_start_at timestamptz,
  duration_ms integer,
  width integer,
  height integer,
  fps numeric(6, 3),
  -- Manual correction to recorded_start_at, from the sync screen.
  nudge_ms integer not null default 0,

  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rr_film_cameras_drive_file check (source <> 'drive' or drive_file_id is not null)
);

create index rr_film_cameras_game_idx on public.rr_film_cameras (game_id, position);
-- The same Drive file can't be imported twice into one game.
create unique index rr_film_cameras_game_drive_file_key
  on public.rr_film_cameras (game_id, drive_file_id) where drive_file_id is not null;

-- Keep team_id in step with the game and bump updated_at.
create function public.rr_film_cameras_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.game_id is distinct from old.game_id then
    select g.team_id into new.team_id from public.rr_games g where g.id = new.game_id;
    if new.team_id is null then
      raise exception 'Game % not found', new.game_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.rr_film_cameras_sync() from public, anon, authenticated;

create trigger rr_film_cameras_sync
  before insert or update on public.rr_film_cameras
  for each row execute function public.rr_film_cameras_sync();

alter table public.rr_film_cameras enable row level security;

-- Everyone on the team watches film; staff manage cameras. The worker uses
-- the service role, which bypasses these policies.
create policy "rr_film_cameras: members read"
  on public.rr_film_cameras for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_film_cameras: staff insert"
  on public.rr_film_cameras for insert to authenticated
  with check (
    public.rr_has_team_role(
      (select g.team_id from public.rr_games g where g.id = game_id),
      array['admin', 'coach']
    )
  );
create policy "rr_film_cameras: staff update"
  on public.rr_film_cameras for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_film_cameras: staff delete"
  on public.rr_film_cameras for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- Storage paths, status and recording details are written only by the worker
-- (service role). Signed playback links are made from these paths, so letting
-- a client set them would let staff point a camera at another team's video.
revoke insert, update on public.rr_film_cameras from anon, authenticated;
grant insert (game_id, name, position, source, drive_file_id, source_name, size_bytes)
  on public.rr_film_cameras to authenticated;
grant update (name, position, nudge_ms) on public.rr_film_cameras to authenticated;
