-- Film review, parts 2 and 3: play windows, custom clips and downloads.
--
-- Plays are lined up with video by their logged time (see src/lib/film/sync.ts),
-- so nothing here stores video offsets except download cuts, which are made
-- from one camera's file.
--
-- Shared database: everything is prefixed rr_ and created without
-- "if not exists" so a clash fails loudly instead of reusing another app's table.

-- ---------- Team default play window ----------
-- Scorers log a play a few seconds after it ends, so a play's window starts
-- this long before the logged time and ends this long after it.
alter table public.rr_teams
  add column film_pre_roll_s smallint not null default 20
    constraint rr_teams_film_pre_roll_s check (film_pre_roll_s between 0 and 120),
  add column film_post_roll_s smallint not null default 4
    constraint rr_teams_film_post_roll_s check (film_post_roll_s between 0 and 60);

-- ---------- Clips ----------
-- Two kinds of row:
--   play_id set:  a coach's adjusted start/end for that logged play;
--   play_id null: a custom clip with a title.
-- Times are real-world times, so a clip lines up on every camera.
create table public.rr_film_clips (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.rr_games(id) on delete cascade,
  -- Copied from the game by trigger so access rules don't need a join.
  team_id uuid not null references public.rr_teams(id) on delete cascade,
  play_id bigint,
  title text check (title is null or char_length(title) between 1 and 80),
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rr_film_clips_range check (end_at > start_at and end_at - start_at <= interval '30 minutes'),
  constraint rr_film_clips_kind check (play_id is not null or title is not null)
);

create index rr_film_clips_game_idx on public.rr_film_clips (game_id, start_at);
create unique index rr_film_clips_game_play_key
  on public.rr_film_clips (game_id, play_id) where play_id is not null;

create function public.rr_film_clips_sync()
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
revoke all on function public.rr_film_clips_sync() from public, anon, authenticated;

create trigger rr_film_clips_sync
  before insert or update on public.rr_film_clips
  for each row execute function public.rr_film_clips_sync();

alter table public.rr_film_clips enable row level security;

-- Everyone on the team sees clips. Admins, coaches and stat keepers make
-- custom clips; only admins and coaches adjust a logged play's window.
create policy "rr_film_clips: members read"
  on public.rr_film_clips for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_film_clips: staff insert"
  on public.rr_film_clips for insert to authenticated
  with check (
    public.rr_has_team_role(
      (select g.team_id from public.rr_games g where g.id = game_id),
      case when play_id is null then array['admin', 'coach', 'stat_keeper'] else array['admin', 'coach'] end
    )
  );
create policy "rr_film_clips: staff update"
  on public.rr_film_clips for update to authenticated
  using (
    public.rr_has_team_role(
      team_id,
      case when play_id is null then array['admin', 'coach', 'stat_keeper'] else array['admin', 'coach'] end
    )
  )
  with check (
    public.rr_has_team_role(
      team_id,
      case when play_id is null then array['admin', 'coach', 'stat_keeper'] else array['admin', 'coach'] end
    )
  );
create policy "rr_film_clips: staff delete"
  on public.rr_film_clips for delete to authenticated
  using (
    public.rr_has_team_role(
      team_id,
      case when play_id is null then array['admin', 'coach', 'stat_keeper'] else array['admin', 'coach'] end
    )
  );

revoke insert, update on public.rr_film_clips from anon, authenticated;
grant insert (game_id, play_id, title, start_at, end_at) on public.rr_film_clips to authenticated;
grant update (title, start_at, end_at) on public.rr_film_clips to authenticated;

-- ---------- Downloads ----------
-- One row per cut the film worker makes from a camera's original. Rows are
-- reused for the same camera, range and overlay until the file expires (the
-- bucket deletes exports/ objects after 30 days).
create table public.rr_film_exports (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.rr_film_cameras(id) on delete cascade,
  -- Copied from the camera by trigger.
  game_id uuid not null references public.rr_games(id) on delete cascade,
  team_id uuid not null references public.rr_teams(id) on delete cascade,

  -- Range within the camera's video, in milliseconds.
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,

  -- Burn the scoreboard into the video. overlay_segments holds what to show
  -- and when (milliseconds from the start of the cut). The app reuses a cut
  -- only when these match what the scoreboard would show now.
  overlay boolean not null default false,
  overlay_segments jsonb,

  file_name text not null check (char_length(file_name) between 1 and 200),

  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  path text,
  size_bytes bigint,
  error text,
  job_execution text,

  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A day before the bucket deletes the file.
  expires_at timestamptz not null default now() + interval '29 days',

  constraint rr_film_exports_range check (end_ms > start_ms and end_ms - start_ms <= 30 * 60 * 1000),
  constraint rr_film_exports_overlay check (overlay = (overlay_segments is not null))
);

create index rr_film_exports_game_idx on public.rr_film_exports (game_id, created_at desc);
create index rr_film_exports_reuse_idx on public.rr_film_exports (camera_id, start_ms, end_ms);

create function public.rr_film_exports_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.camera_id is distinct from old.camera_id then
    select c.game_id, c.team_id into new.game_id, new.team_id
      from public.rr_film_cameras c where c.id = new.camera_id;
    if new.game_id is null then
      raise exception 'Camera % not found', new.camera_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.rr_film_exports_sync() from public, anon, authenticated;

create trigger rr_film_exports_sync
  before insert or update on public.rr_film_exports
  for each row execute function public.rr_film_exports_sync();

alter table public.rr_film_exports enable row level security;

-- Anyone on the team can download. Status, paths and sizes are written only
-- by the worker (service role); the app's request handler inserts the row.
create policy "rr_film_exports: members read"
  on public.rr_film_exports for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_film_exports: members request"
  on public.rr_film_exports for insert to authenticated
  with check (
    public.rr_is_team_member((select c.team_id from public.rr_film_cameras c where c.id = camera_id))
    and requested_by = auth.uid()
  );

revoke insert, update, delete on public.rr_film_exports from anon, authenticated;
grant insert (camera_id, start_ms, end_ms, overlay, overlay_segments, file_name)
  on public.rr_film_exports to authenticated;
