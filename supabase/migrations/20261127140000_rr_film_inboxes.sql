-- Film review: team film inboxes (automatic game matching).
--
-- An inbox is a Google Drive folder linked to one or more teams, each with a
-- short film code. Inside it, a coach creates one folder per game named
--   <code>_<date>_<opponent>[_<n>]      e.g. varsity_12-2-26_monroe_1
-- The film-watcher matches the folder to the scorekeeper's game and creates a
-- watch for it (rr_film_watches, source 'inbox'), which imports the camera files.
--
-- Inboxes are platform-managed for now (set up by the RouteRunnr admin with the
-- service role), so there are no client write grants. Only folders inside a
-- linked inbox are read, so a stranger sharing a folder named "varsity_..."
-- with the importer account can't put film in a team's games.
--
-- Shared database: rr_ prefix, no "if not exists".

create table public.rr_film_inboxes (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null unique check (folder_id ~ '^[A-Za-z0-9_-]{10,}$'),
  folder_name text,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table public.rr_film_inbox_teams (
  inbox_id uuid not null references public.rr_film_inboxes(id) on delete cascade,
  team_id uuid not null references public.rr_teams(id) on delete cascade,
  -- The first part of a game folder's name, e.g. "varsity".
  code text not null check (code ~ '^[a-z0-9]{1,30}$'),
  primary key (inbox_id, team_id),
  constraint rr_film_inbox_teams_code_key unique (inbox_id, code)
);

-- Every game folder the watcher has seen in an inbox, matched or not.
create table public.rr_film_inbox_folders (
  id uuid primary key default gen_random_uuid(),
  inbox_id uuid not null references public.rr_film_inboxes(id) on delete cascade,
  folder_id text not null unique,
  folder_name text not null,
  team_id uuid references public.rr_teams(id) on delete set null,
  game_id uuid references public.rr_games(id) on delete set null,
  status text not null check (status in ('matched', 'unmatched')),
  -- Why it didn't match, in words a coach can act on.
  reason text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rr_film_inbox_folders_inbox_idx on public.rr_film_inbox_folders (inbox_id, status);

-- Watches created from an inbox are marked so the Film page can say so.
alter table public.rr_film_watches
  add column source text not null default 'manual' check (source in ('manual', 'inbox'));

-- Is the current user on any team linked to this inbox?
create function public.rr_film_inbox_member(p_inbox uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.rr_film_inbox_teams it
    where it.inbox_id = p_inbox and public.rr_is_team_member(it.team_id)
  );
$$;
revoke all on function public.rr_film_inbox_member(uuid) from public;
grant execute on function public.rr_film_inbox_member(uuid) to authenticated;

alter table public.rr_film_inboxes enable row level security;
alter table public.rr_film_inbox_teams enable row level security;
alter table public.rr_film_inbox_folders enable row level security;

create policy "rr_film_inboxes: linked teams read"
  on public.rr_film_inboxes for select to authenticated
  using (public.rr_film_inbox_member(id));
create policy "rr_film_inbox_teams: members read"
  on public.rr_film_inbox_teams for select to authenticated
  using (public.rr_is_team_member(team_id));
-- Unmatched folders may not have a team yet (unknown code), so anyone on a
-- linked team can see the inbox's folders.
create policy "rr_film_inbox_folders: linked teams read"
  on public.rr_film_inbox_folders for select to authenticated
  using (public.rr_film_inbox_member(inbox_id));

revoke insert, update, delete on public.rr_film_inboxes, public.rr_film_inbox_teams, public.rr_film_inbox_folders
  from anon, authenticated;
