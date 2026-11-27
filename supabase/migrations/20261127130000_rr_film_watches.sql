-- Film review: watched Google Drive folders.
--
-- A coach attaches a Drive folder to a game. A scheduled job (film-watcher,
-- every 5 minutes) lists each active folder and imports any finished video
-- files it hasn't seen, creating rr_film_cameras rows and starting the import
-- worker. Watches stop on their own at expires_at.
--
-- Shared database: rr_ prefix, no "if not exists".

create table public.rr_film_watches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.rr_games(id) on delete cascade,
  team_id uuid not null references public.rr_teams(id) on delete cascade,
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,}$'),
  folder_name text,
  active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '7 days'),
  -- Written by the watcher (service role).
  last_checked_at timestamptz,
  last_error text,
  imported_count integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rr_film_watches_game_folder_key unique (game_id, folder_id)
);

create index rr_film_watches_active_idx on public.rr_film_watches (expires_at) where active;

create function public.rr_film_watches_sync()
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
revoke all on function public.rr_film_watches_sync() from public, anon, authenticated;

create trigger rr_film_watches_sync
  before insert or update on public.rr_film_watches
  for each row execute function public.rr_film_watches_sync();

alter table public.rr_film_watches enable row level security;

create policy "rr_film_watches: members read"
  on public.rr_film_watches for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_film_watches: staff insert"
  on public.rr_film_watches for insert to authenticated
  with check (
    public.rr_has_team_role(
      (select g.team_id from public.rr_games g where g.id = game_id),
      array['admin', 'coach']
    )
  );
create policy "rr_film_watches: staff update"
  on public.rr_film_watches for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_film_watches: staff delete"
  on public.rr_film_watches for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- Coaches choose the folder and can pause, resume or extend a watch; the
-- watcher's bookkeeping columns are service-role only.
revoke insert, update on public.rr_film_watches from anon, authenticated;
grant insert (game_id, folder_id, folder_name, expires_at) on public.rr_film_watches to authenticated;
grant update (active, expires_at, folder_name) on public.rr_film_watches to authenticated;
