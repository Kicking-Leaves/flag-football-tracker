-- Team roles and shared access.
--
-- Until now a team was visible only to its owner. Teams now have members, each
-- with one role:
--
--   admin, coach   everything (separate so admin-only features can come later)
--   stat_keeper    create and score games, edit game stats, export
--   player         view games, results and stats
--   parent         view games, players and stats
--
-- People join through invite links created by an admin or coach. The team's
-- creator becomes its first admin, and every existing team's owner is
-- backfilled as admin.
--
-- Coach notes on players move to rr_player_notes, readable only by admins and
-- coaches, since players and parents can now read the roster.

-- ---------- members ----------

create table public.rr_team_members (
  team_id     uuid not null references public.rr_teams (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null
              check (role in ('admin', 'coach', 'stat_keeper', 'player', 'parent')),
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index rr_team_members_user_id_idx on public.rr_team_members (user_id);

insert into public.rr_team_members (team_id, user_id, role)
select id, owner_id, 'admin'
from public.rr_teams t
where t.owner_id is not null
  and exists (select 1 from auth.users u where u.id = t.owner_id)
on conflict do nothing;

-- ---------- role helpers ----------
-- SECURITY DEFINER so policies can consult membership without recursing
-- through rr_team_members' own RLS.

create function public.rr_team_role(p_team uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select m.role
  from public.rr_team_members m
  where m.team_id = p_team and m.user_id = auth.uid();
$$;

create function public.rr_has_team_role(p_team uuid, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(public.rr_team_role(p_team) = any (p_roles), false);
$$;

create function public.rr_is_team_member(p_team uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.rr_team_role(p_team) is not null;
$$;

-- Owner of the school, or one of p_roles on any team at the school.
create function public.rr_school_access(p_school uuid, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
      select 1 from public.rr_schools s
      where s.id = p_school and s.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.rr_teams t
      join public.rr_team_members m on m.team_id = t.id
      where t.school_id = p_school
        and m.user_id = auth.uid()
        and m.role = any (p_roles)
    );
$$;

revoke all on function public.rr_team_role(uuid) from public;
revoke all on function public.rr_has_team_role(uuid, text[]) from public;
revoke all on function public.rr_is_team_member(uuid) from public;
revoke all on function public.rr_school_access(uuid, text[]) from public;
grant execute on function public.rr_team_role(uuid) to authenticated;
grant execute on function public.rr_has_team_role(uuid, text[]) to authenticated;
grant execute on function public.rr_is_team_member(uuid) to authenticated;
grant execute on function public.rr_school_access(uuid, text[]) to authenticated;

-- ---------- member guard ----------
-- Only admins may grant, change or remove the admin role, and a team always
-- keeps at least one admin. Skipped for the SQL editor / service role
-- (auth.uid() is null) and while the team itself is being deleted.

create function public.rr_team_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touches_admin boolean;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.rr_teams t where t.id = old.team_id) then
    return coalesce(new, old);
  end if;

  touches_admin := old.role = 'admin' or (tg_op = 'UPDATE' and new.role = 'admin');
  if touches_admin
     and old.user_id <> auth.uid()
     and not public.rr_has_team_role(old.team_id, array['admin']) then
    raise exception 'Only an admin can change or remove an admin.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and old.role <> 'admin'
     and not public.rr_has_team_role(old.team_id, array['admin']) then
    raise exception 'Only an admin can make someone an admin.'
      using errcode = '42501';
  end if;

  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.rr_team_members m
       where m.team_id = old.team_id
         and m.role = 'admin'
         and m.user_id <> old.user_id
     ) then
    raise exception 'A team needs at least one admin.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    new.team_id := old.team_id;
    new.user_id := old.user_id;
    return new;
  end if;
  return old;
end;
$$;

revoke all on function public.rr_team_members_guard() from public, anon, authenticated;

create trigger rr_team_members_guard
  before update or delete on public.rr_team_members
  for each row execute function public.rr_team_members_guard();

alter table public.rr_team_members enable row level security;

create policy "rr_team_members: read own or as staff"
  on public.rr_team_members for select to authenticated
  using (user_id = auth.uid() or public.rr_has_team_role(team_id, array['admin', 'coach']));

create policy "rr_team_members: staff change roles"
  on public.rr_team_members for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));

create policy "rr_team_members: staff remove, anyone leave"
  on public.rr_team_members for delete to authenticated
  using (user_id = auth.uid() or public.rr_has_team_role(team_id, array['admin', 'coach']));

-- No insert policy: members are added by rr_create_team and rr_accept_invite.

-- ---------- invites ----------

create table public.rr_team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.rr_teams (id) on delete cascade,
  role        text not null
              check (role in ('admin', 'coach', 'stat_keeper', 'player', 'parent')),
  -- Single-use links are spent by the first person who accepts; reusable links
  -- (e.g. one link for all parents) work until they expire or are revoked.
  single_use  boolean not null default true,
  used_count  int not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  revoked_at  timestamptz
);

create index rr_team_invites_team_id_idx on public.rr_team_invites (team_id);

alter table public.rr_team_invites enable row level security;

create policy "rr_team_invites: staff read"
  on public.rr_team_invites for select to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

create policy "rr_team_invites: staff create"
  on public.rr_team_invites for insert to authenticated
  with check (
    public.rr_has_team_role(team_id, array['admin', 'coach'])
    and (role <> 'admin' or public.rr_has_team_role(team_id, array['admin']))
  );

create policy "rr_team_invites: staff revoke"
  on public.rr_team_invites for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (
    public.rr_has_team_role(team_id, array['admin', 'coach'])
    and (role <> 'admin' or public.rr_has_team_role(team_id, array['admin']))
  );

create policy "rr_team_invites: staff delete"
  on public.rr_team_invites for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- What an invite link is for, shown before accepting. Callable signed out so
-- the page can say which team the link joins.
create function public.rr_get_invite(p_invite uuid)
returns table (team_id uuid, team_name text, role text, status text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    i.team_id,
    t.name,
    i.role,
    case
      when i.revoked_at is not null then 'revoked'
      when i.expires_at < now() then 'expired'
      when i.single_use and i.used_count > 0 then 'used'
      else 'valid'
    end
  from public.rr_team_invites i
  join public.rr_teams t on t.id = i.team_id
  where i.id = p_invite;
$$;

-- Join the team an invite is for. Someone already on the team keeps their
-- current role (an admin or coach can change it). Returns the team id.
create function public.rr_accept_invite(p_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.rr_team_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept an invite.' using errcode = '42501';
  end if;

  select * into inv from public.rr_team_invites where id = p_invite for update;
  if not found then
    raise exception 'This invite link is not valid.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.rr_team_members m
    where m.team_id = inv.team_id and m.user_id = auth.uid()
  ) then
    return inv.team_id;
  end if;

  if inv.revoked_at is not null then
    raise exception 'This invite link was turned off.' using errcode = '22023';
  elsif inv.expires_at < now() then
    raise exception 'This invite link has expired.' using errcode = '22023';
  elsif inv.single_use and inv.used_count > 0 then
    raise exception 'This invite link has already been used.' using errcode = '22023';
  end if;

  insert into public.rr_team_members (team_id, user_id, role)
  values (inv.team_id, auth.uid(), inv.role);

  update public.rr_team_invites set used_count = used_count + 1 where id = inv.id;
  return inv.team_id;
end;
$$;

-- Members with their sign-in emails, for admins and coaches only.
create function public.rr_team_member_list(p_team uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.rr_team_members m
  join auth.users u on u.id = m.user_id
  where m.team_id = p_team
    and public.rr_has_team_role(p_team, array['admin', 'coach'])
  order by m.created_at;
$$;

revoke all on function public.rr_get_invite(uuid) from public;
revoke all on function public.rr_accept_invite(uuid) from public;
revoke all on function public.rr_team_member_list(uuid) from public;
grant execute on function public.rr_get_invite(uuid) to anon, authenticated;
grant execute on function public.rr_accept_invite(uuid) to authenticated;
grant execute on function public.rr_team_member_list(uuid) to authenticated;

-- ---------- team creation ----------
-- Creates the team and makes the caller its admin in one step.

create function public.rr_create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  insert into public.rr_teams (owner_id, name)
  values (auth.uid(), p_name)
  returning id into new_id;
  insert into public.rr_team_members (team_id, user_id, role)
  values (new_id, auth.uid(), 'admin');
  return new_id;
end;
$$;

revoke all on function public.rr_create_team(text) from public;
grant execute on function public.rr_create_team(text) to authenticated;

-- ---------- coach notes ----------

create table public.rr_player_notes (
  player_id   uuid primary key references public.rr_players (id) on delete cascade,
  notes       text not null,
  updated_at  timestamptz not null default now()
);

insert into public.rr_player_notes (player_id, notes)
select id, notes
from public.rr_players
where notes is not null and length(trim(notes)) > 0;

alter table public.rr_players drop column notes;

alter table public.rr_player_notes enable row level security;

create policy "rr_player_notes: staff only"
  on public.rr_player_notes for all to authenticated
  using (
    exists (
      select 1 from public.rr_players p
      where p.id = rr_player_notes.player_id
        and public.rr_has_team_role(p.team_id, array['admin', 'coach'])
    )
  )
  with check (
    exists (
      select 1 from public.rr_players p
      where p.id = rr_player_notes.player_id
        and public.rr_has_team_role(p.team_id, array['admin', 'coach'])
    )
  );

-- ---------- replace data-table policies ----------
-- Drop whatever owner-only policies exist today, then grant by role.

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('rr_teams', 'rr_seasons', 'rr_players', 'rr_games',
                        'rr_schools', 'rr_athletes')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

alter table public.rr_teams    enable row level security;
alter table public.rr_seasons  enable row level security;
alter table public.rr_players  enable row level security;
alter table public.rr_games    enable row level security;
alter table public.rr_schools  enable row level security;
alter table public.rr_athletes enable row level security;

-- rr_teams (created through rr_create_team, so no insert policy)
create policy "rr_teams: members read"
  on public.rr_teams for select to authenticated
  using (public.rr_is_team_member(id));
create policy "rr_teams: staff update"
  on public.rr_teams for update to authenticated
  using (public.rr_has_team_role(id, array['admin', 'coach']))
  with check (
    public.rr_has_team_role(id, array['admin', 'coach'])
    and (school_id is null or public.rr_school_access(school_id, array['admin', 'coach']))
  );
create policy "rr_teams: staff delete"
  on public.rr_teams for delete to authenticated
  using (public.rr_has_team_role(id, array['admin', 'coach']));

-- rr_seasons
create policy "rr_seasons: members read"
  on public.rr_seasons for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_seasons: staff insert"
  on public.rr_seasons for insert to authenticated
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_seasons: staff update"
  on public.rr_seasons for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_seasons: staff delete"
  on public.rr_seasons for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- rr_players (the roster)
create policy "rr_players: members read"
  on public.rr_players for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_players: staff insert"
  on public.rr_players for insert to authenticated
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_players: staff update"
  on public.rr_players for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach']));
create policy "rr_players: staff delete"
  on public.rr_players for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- rr_games: stat keepers create and score; only staff delete
create policy "rr_games: members read"
  on public.rr_games for select to authenticated
  using (public.rr_is_team_member(team_id));
create policy "rr_games: scorers insert"
  on public.rr_games for insert to authenticated
  with check (public.rr_has_team_role(team_id, array['admin', 'coach', 'stat_keeper']));
create policy "rr_games: scorers update"
  on public.rr_games for update to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach', 'stat_keeper']))
  with check (public.rr_has_team_role(team_id, array['admin', 'coach', 'stat_keeper']));
create policy "rr_games: staff delete"
  on public.rr_games for delete to authenticated
  using (public.rr_has_team_role(team_id, array['admin', 'coach']));

-- rr_schools
create policy "rr_schools: owner or members read"
  on public.rr_schools for select to authenticated
  using (
    public.rr_school_access(id, array['admin', 'coach', 'stat_keeper', 'player', 'parent'])
  );
create policy "rr_schools: create own"
  on public.rr_schools for insert to authenticated
  with check (owner_id = auth.uid());
create policy "rr_schools: owner update"
  on public.rr_schools for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "rr_schools: owner delete"
  on public.rr_schools for delete to authenticated
  using (owner_id = auth.uid());

-- rr_athletes
create policy "rr_athletes: members read"
  on public.rr_athletes for select to authenticated
  using (
    public.rr_school_access(school_id, array['admin', 'coach', 'stat_keeper', 'player', 'parent'])
  );
create policy "rr_athletes: staff insert"
  on public.rr_athletes for insert to authenticated
  with check (public.rr_school_access(school_id, array['admin', 'coach']));
create policy "rr_athletes: staff update"
  on public.rr_athletes for update to authenticated
  using (public.rr_school_access(school_id, array['admin', 'coach']))
  with check (public.rr_school_access(school_id, array['admin', 'coach']));
create policy "rr_athletes: staff delete"
  on public.rr_athletes for delete to authenticated
  using (public.rr_school_access(school_id, array['admin', 'coach']));
