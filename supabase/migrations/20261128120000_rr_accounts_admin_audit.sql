-- Gated sign-ups, site admins, and an audit log of game changes.
--
-- 1. Accounts. Everyone who uses RouteRunnr has a row in rr_accounts.
--    New sign-ups verify their email, then request an account (pending) that
--    a site admin approves. Signing up through a valid team invite approves
--    the account right away. Suspended accounts lose access to all team data.
--    Auth users are shared with another app in this Supabase project, so the
--    gate lives here rather than in Supabase's sign-up settings.
-- 2. Site admins (rr_accounts.is_site_admin) are separate from team roles.
--    They manage every account, team membership and role through the
--    rr_admin_* functions below.
-- 3. rr_game_audit records every change to a game: who, when, and what
--    changed in the play log, score, status or game details. Written by a
--    trigger, so it can't be skipped by the app. Site admins and the team's
--    admins can read it.
--
-- Shared database: rr_ prefix, no "if not exists".

-- ---------- accounts ----------

create table public.rr_accounts (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'suspended', 'rejected')),
  full_name        text check (char_length(full_name) <= 100),
  request_note     text check (char_length(request_note) <= 500),
  is_site_admin    boolean not null default false,
  -- How the account was approved: 'admin', 'invite', or 'existing' (backfill).
  approved_via     text,
  status_reason    text check (char_length(status_reason) <= 500),
  requested_at     timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references auth.users (id) on delete set null,
  -- Set once the site admins have been emailed about this request.
  notified_at      timestamptz,
  updated_at       timestamptz not null default now()
);

create index rr_accounts_status_idx on public.rr_accounts (status);

alter table public.rr_accounts enable row level security;

-- Everyone who already uses RouteRunnr is approved. The first of them (the
-- owner of the existing teams) becomes the site admin.
insert into public.rr_accounts (user_id, status, approved_via, decided_at)
select u.id, 'approved', 'existing', now()
from auth.users u
where u.id in (
  select user_id from public.rr_team_members
  union select owner_id from public.rr_teams where owner_id is not null
  union select owner_id from public.rr_schools where owner_id is not null
);

update public.rr_accounts a
set is_site_admin = true
from auth.users u
where u.id = a.user_id and lower(u.email) = 'dan@kickingleaves.com';

-- Is the signed-in user an approved RouteRunnr user?
create function public.rr_account_active()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.rr_accounts
    where user_id = auth.uid() and status = 'approved'
  );
$$;

create function public.rr_is_site_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.rr_accounts
    where user_id = auth.uid() and status = 'approved' and is_site_admin
  );
$$;

revoke all on function public.rr_account_active() from public;
revoke all on function public.rr_is_site_admin() from public;
grant execute on function public.rr_account_active() to authenticated;
grant execute on function public.rr_is_site_admin() to authenticated;

create policy "rr_accounts: read own, site admins read all"
  on public.rr_accounts for select to authenticated
  using (user_id = auth.uid() or public.rr_is_site_admin());
-- No client writes: accounts change through the functions below.
revoke insert, update, delete on public.rr_accounts from anon, authenticated;

-- ---------- gate team data on an approved account ----------
-- Every team policy goes through rr_team_role, so an account that isn't
-- approved (pending, suspended, rejected) sees no team data at all.

create or replace function public.rr_team_role(p_team uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select m.role
  from public.rr_team_members m
  join public.rr_accounts a on a.user_id = m.user_id and a.status = 'approved'
  where m.team_id = p_team and m.user_id = auth.uid();
$$;

create or replace function public.rr_school_access(p_school uuid, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.rr_account_active() and (
    exists (
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
    )
  );
$$;

drop policy "rr_schools: create own" on public.rr_schools;
drop policy "rr_schools: owner update" on public.rr_schools;
drop policy "rr_schools: owner delete" on public.rr_schools;
create policy "rr_schools: create own"
  on public.rr_schools for insert to authenticated
  with check (owner_id = auth.uid() and public.rr_account_active());
create policy "rr_schools: owner update"
  on public.rr_schools for update to authenticated
  using (owner_id = auth.uid() and public.rr_account_active())
  with check (owner_id = auth.uid() and public.rr_account_active());
create policy "rr_schools: owner delete"
  on public.rr_schools for delete to authenticated
  using (owner_id = auth.uid() and public.rr_account_active());

create or replace function public.rr_create_team(p_name text)
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
  if not public.rr_account_active() then
    raise exception 'Your account isn''t approved yet.' using errcode = '42501';
  end if;
  insert into public.rr_teams (owner_id, name)
  values (auth.uid(), p_name)
  returning id into new_id;
  insert into public.rr_team_members (team_id, user_id, role)
  values (new_id, auth.uid(), 'admin');
  return new_id;
end;
$$;

-- ---------- requesting an account ----------

-- After verifying their email, a new user asks for an account. Returns the
-- account's status. Calling it again updates the name and note of a pending
-- request; a rejected request goes back to pending.
create function public.rr_request_account(p_full_name text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.rr_accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Verify your email first.' using errcode = '42501';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;

  select * into acct from public.rr_accounts where user_id = auth.uid() for update;
  if not found then
    insert into public.rr_accounts (user_id, status, full_name, request_note)
    values (auth.uid(), 'pending', trim(p_full_name), nullif(trim(p_note), ''));
    return 'pending';
  end if;

  if acct.status in ('pending', 'rejected') then
    update public.rr_accounts
    set full_name = trim(p_full_name),
        request_note = nullif(trim(p_note), ''),
        status = 'pending',
        requested_at = case when acct.status = 'rejected' then now() else acct.requested_at end,
        notified_at = case when acct.status = 'rejected' then null else acct.notified_at end,
        updated_at = now()
    where user_id = auth.uid();
    return 'pending';
  end if;

  if acct.full_name is null then
    update public.rr_accounts set full_name = trim(p_full_name), updated_at = now()
    where user_id = auth.uid();
  end if;
  return acct.status;
end;
$$;

revoke all on function public.rr_request_account(text, text) from public;
grant execute on function public.rr_request_account(text, text) to authenticated;

-- Who to email about a new request: the site admins' addresses, handed out
-- once per request and only to the person who just made it (so the app can
-- send the notice without a service key). Empty afterwards.
create function public.rr_take_request_notification()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  emails text[];
begin
  update public.rr_accounts
  set notified_at = now()
  where user_id = auth.uid()
    and status = 'pending'
    and notified_at is null
    and requested_at > now() - interval '15 minutes';
  if not found then
    return array[]::text[];
  end if;
  select coalesce(array_agg(u.email::text), array[]::text[]) into emails
  from public.rr_accounts a
  join auth.users u on u.id = a.user_id
  where a.is_site_admin and a.status = 'approved';
  return emails;
end;
$$;

revoke all on function public.rr_take_request_notification() from public;
grant execute on function public.rr_take_request_notification() to authenticated;

-- Joining through a valid invite approves a new or pending account (an
-- admin or coach sent it). Suspended and rejected accounts can't use invites.
create or replace function public.rr_accept_invite(p_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.rr_team_invites%rowtype;
  acct_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept an invite.' using errcode = '42501';
  end if;

  select * into inv from public.rr_team_invites where id = p_invite for update;
  if not found then
    raise exception 'This invite link is not valid.' using errcode = 'P0002';
  end if;

  select status into acct_status from public.rr_accounts where user_id = auth.uid();
  if acct_status in ('suspended', 'rejected') then
    raise exception 'Your account can''t join teams. Contact the RouteRunnr admin.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.rr_team_members m
    where m.team_id = inv.team_id and m.user_id = auth.uid()
  ) and acct_status = 'approved' then
    return inv.team_id;
  end if;

  if inv.revoked_at is not null then
    raise exception 'This invite link was turned off.' using errcode = '22023';
  elsif inv.expires_at < now() then
    raise exception 'This invite link has expired.' using errcode = '22023';
  elsif inv.single_use and inv.used_count > 0 then
    raise exception 'This invite link has already been used.' using errcode = '22023';
  end if;

  if acct_status is distinct from 'approved' then
    if not exists (
      select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
    ) then
      raise exception 'Verify your email first.' using errcode = '42501';
    end if;
    insert into public.rr_accounts (user_id, status, approved_via, decided_at, decided_by)
    values (auth.uid(), 'approved', 'invite', now(), inv.created_by)
    on conflict (user_id) do update
      set status = 'approved', approved_via = 'invite', decided_at = now(),
          decided_by = inv.created_by, updated_at = now();
  end if;

  insert into public.rr_team_members (team_id, user_id, role)
  values (inv.team_id, auth.uid(), inv.role)
  on conflict (team_id, user_id) do nothing;

  update public.rr_team_invites set used_count = used_count + 1 where id = inv.id;
  return inv.team_id;
end;
$$;

-- ---------- site admin: accounts and memberships ----------

create function public.rr_require_site_admin()
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.rr_is_site_admin() then
    raise exception 'Site admins only.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.rr_require_site_admin() from public, anon, authenticated;

-- Every RouteRunnr account with its sign-in details and team roles.
create function public.rr_admin_accounts()
returns table (
  user_id uuid,
  email text,
  full_name text,
  status text,
  is_site_admin boolean,
  approved_via text,
  status_reason text,
  request_note text,
  requested_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  teams jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  return query
  select
    a.user_id,
    u.email::text,
    a.full_name,
    a.status,
    a.is_site_admin,
    a.approved_via,
    a.status_reason,
    a.request_note,
    a.requested_at,
    a.decided_at,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at is not null,
    coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', t.name, 'role', m.role)
                       order by t.name)
      from public.rr_team_members m
      join public.rr_teams t on t.id = m.team_id
      where m.user_id = a.user_id
    ), '[]'::jsonb)
  from public.rr_accounts a
  join auth.users u on u.id = a.user_id
  order by (a.status = 'pending') desc, a.requested_at desc;
end;
$$;

-- All teams, for the admin page's team pickers.
create function public.rr_admin_teams()
returns table (id uuid, name text, school_name text, member_count bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  return query
  select t.id, t.name, s.name, (select count(*) from public.rr_team_members m where m.team_id = t.id)
  from public.rr_teams t
  left join public.rr_schools s on s.id = t.school_id
  order by t.name;
end;
$$;

-- Approve, reject, suspend or reactivate an account.
create function public.rr_admin_set_status(p_user uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  if p_status not in ('approved', 'suspended', 'rejected') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_user = auth.uid() and p_status <> 'approved' then
    raise exception 'You can''t suspend or reject your own account.' using errcode = '22023';
  end if;
  update public.rr_accounts
  set status = p_status,
      status_reason = nullif(trim(p_reason), ''),
      approved_via = case when p_status = 'approved' then coalesce(approved_via, 'admin') else approved_via end,
      decided_at = now(),
      decided_by = auth.uid(),
      updated_at = now()
  where user_id = p_user;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.rr_admin_set_site_admin(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  if not p_on and p_user = auth.uid() then
    raise exception 'You can''t remove your own site admin role.' using errcode = '22023';
  end if;
  update public.rr_accounts
  set is_site_admin = p_on, updated_at = now()
  where user_id = p_user and (status = 'approved' or not p_on);
  if not found then
    raise exception 'Only approved accounts can be site admins.' using errcode = '22023';
  end if;
end;
$$;

-- Add someone to a team or change their role there.
create function public.rr_admin_set_team_role(p_user uuid, p_team uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  if p_role not in ('admin', 'coach', 'stat_keeper', 'player', 'parent') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rr_accounts where user_id = p_user) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  insert into public.rr_team_members (team_id, user_id, role)
  values (p_team, p_user, p_role)
  on conflict (team_id, user_id) do update set role = excluded.role;
end;
$$;

create function public.rr_admin_remove_from_team(p_user uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rr_require_site_admin();
  delete from public.rr_team_members where team_id = p_team and user_id = p_user;
end;
$$;

revoke all on function public.rr_admin_accounts() from public;
revoke all on function public.rr_admin_teams() from public;
revoke all on function public.rr_admin_set_status(uuid, text, text) from public;
revoke all on function public.rr_admin_set_site_admin(uuid, boolean) from public;
revoke all on function public.rr_admin_set_team_role(uuid, uuid, text) from public;
revoke all on function public.rr_admin_remove_from_team(uuid, uuid) from public;
grant execute on function public.rr_admin_accounts() to authenticated;
grant execute on function public.rr_admin_teams() to authenticated;
grant execute on function public.rr_admin_set_status(uuid, text, text) to authenticated;
grant execute on function public.rr_admin_set_site_admin(uuid, boolean) to authenticated;
grant execute on function public.rr_admin_set_team_role(uuid, uuid, text) to authenticated;
grant execute on function public.rr_admin_remove_from_team(uuid, uuid) to authenticated;

-- Site admins may change any team's admins; the "team keeps at least one
-- admin" rule still applies.
create or replace function public.rr_team_members_guard()
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

  if not public.rr_is_site_admin() then
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

-- ---------- audit log of game changes ----------

create table public.rr_game_audit (
  id          bigint generated always as identity primary key,
  -- No foreign keys: the history outlives a deleted game.
  game_id     uuid not null,
  team_id     uuid,
  -- Names at the time, so the log reads after a game or team is deleted.
  team_name   text,
  game_label  text,
  actor_id    uuid,
  -- Email at the time, so the log still reads if the account goes away.
  actor_email text,
  at          timestamptz not null default now(),
  action      text not null,
  -- What changed: play log entries added/removed/changed (with their
  -- positions), score before/after, and game detail changes.
  details     jsonb not null default '{}'::jsonb
);

create index rr_game_audit_game_idx on public.rr_game_audit (game_id, at desc);
create index rr_game_audit_team_idx on public.rr_game_audit (team_id, at desc);
create index rr_game_audit_actor_idx on public.rr_game_audit (actor_id, at desc);

alter table public.rr_game_audit enable row level security;

create policy "rr_game_audit: site admins and team admins read"
  on public.rr_game_audit for select to authenticated
  using (public.rr_is_site_admin() or public.rr_has_team_role(team_id, array['admin']));
revoke insert, update, delete on public.rr_game_audit from anon, authenticated;

create function public.rr_games_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fields the engine recomputes for every later entry after an edit; leaving
  -- them out keeps one edit from showing up as dozens.
  derived constant text[] := array['down', 'yardsToGo', 'lineOfScrimmage', 'firstDownTarget'];
  actor uuid := auth.uid();
  actor_mail text;
  added jsonb;
  removed jsonb;
  changed jsonb;
  meta jsonb := '{}'::jsonb;
  old_count int;
  new_count int;
  act text;
  det jsonb;
  g record;
  tname text;
  glabel text;
begin
  select email::text into actor_mail from auth.users where id = actor;
  g := coalesce(new, old);
  select name into tname from public.rr_teams where id = g.team_id;
  glabel := 'vs ' || g.opponent_name || ' · ' || to_char(g.game_date at time zone 'America/Los_Angeles', 'Mon DD, YYYY');

  if tg_op = 'INSERT' then
    insert into public.rr_game_audit (game_id, team_id, team_name, game_label, actor_id, actor_email, action, details)
    values (new.id, new.team_id, tname, glabel, actor, actor_mail, 'game_created', jsonb_build_object(
      'opponent', new.opponent_name, 'game_date', new.game_date,
      'game_type', new.game_type, 'status', new.status));
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Keep the whole game so a deletion can be looked into (or undone by hand).
    insert into public.rr_game_audit (game_id, team_id, team_name, game_label, actor_id, actor_email, action, details)
    values (old.id, old.team_id, tname, glabel, actor, actor_mail, 'game_deleted', jsonb_build_object(
      'opponent', old.opponent_name, 'game_date', old.game_date, 'game_type', old.game_type,
      'status', old.status, 'score', old.game_data->'score', 'game', to_jsonb(old)));
    return old;
  end if;

  -- UPDATE: compare the play logs by entry id.
  with o as (
    select e, (ord - 1)::int as idx, e->>'id' as eid
    from jsonb_array_elements(coalesce(old.game_data->'plays', '[]'::jsonb)) with ordinality t(e, ord)
  ),
  n as (
    select e, (ord - 1)::int as idx, e->>'id' as eid
    from jsonb_array_elements(coalesce(new.game_data->'plays', '[]'::jsonb)) with ordinality t(e, ord)
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('index', n.idx, 'entry', n.e) order by n.idx), '[]'::jsonb)
       from n where not exists (select 1 from o where o.eid = n.eid)),
    (select coalesce(jsonb_agg(jsonb_build_object('index', o.idx, 'entry', o.e) order by o.idx), '[]'::jsonb)
       from o where not exists (select 1 from n where n.eid = o.eid)),
    (select coalesce(jsonb_agg(jsonb_build_object('index', n.idx, 'before', o.e, 'after', n.e) order by n.idx), '[]'::jsonb)
       from o join n on n.eid = o.eid
       where (o.e - derived) is distinct from (n.e - derived))
  into added, removed, changed;

  if old.opponent_name is distinct from new.opponent_name then
    meta := meta || jsonb_build_object('opponent', jsonb_build_array(old.opponent_name, new.opponent_name));
  end if;
  if old.game_date is distinct from new.game_date then
    meta := meta || jsonb_build_object('game_date', jsonb_build_array(old.game_date, new.game_date));
  end if;
  if old.game_type is distinct from new.game_type then
    meta := meta || jsonb_build_object('game_type', jsonb_build_array(old.game_type, new.game_type));
  end if;
  if old.status is distinct from new.status then
    meta := meta || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
  end if;
  if old.season_id is distinct from new.season_id then
    meta := meta || jsonb_build_object('season_id', jsonb_build_array(old.season_id, new.season_id));
  end if;
  if (old.game_data->'roster') is distinct from (new.game_data->'roster') then
    meta := meta || jsonb_build_object('roster', jsonb_build_array(
      jsonb_array_length(coalesce(old.game_data->'roster', '[]'::jsonb)),
      jsonb_array_length(coalesce(new.game_data->'roster', '[]'::jsonb))));
  end if;

  if added = '[]'::jsonb and removed = '[]'::jsonb and changed = '[]'::jsonb and meta = '{}'::jsonb then
    return new; -- nothing a person would call a change (e.g. a repeat save)
  end if;

  old_count := jsonb_array_length(coalesce(old.game_data->'plays', '[]'::jsonb));
  new_count := jsonb_array_length(coalesce(new.game_data->'plays', '[]'::jsonb));

  act := case
    when meta ? 'status' and old.status = 'scheduled' then 'game_started'
    when meta ? 'status' and new.status = 'completed' and added = '[]'::jsonb and removed = '[]'::jsonb and changed = '[]'::jsonb then 'game_completed'
    when meta ? 'status' and old.status = 'completed' and added = '[]'::jsonb and removed = '[]'::jsonb and changed = '[]'::jsonb then 'game_reopened'
    when added = '[]'::jsonb and removed = '[]'::jsonb and changed = '[]'::jsonb then 'game_details_changed'
    when removed = '[]'::jsonb and changed = '[]'::jsonb
         and (select bool_and((x->>'index')::int >= old_count) from jsonb_array_elements(added) x) then 'play_recorded'
    when added = '[]'::jsonb and changed = '[]'::jsonb and jsonb_array_length(removed) = 1
         and (removed->0->>'index')::int = old_count - 1 then 'play_undone'
    when added = '[]'::jsonb and changed = '[]'::jsonb then 'play_deleted'
    when removed = '[]'::jsonb and changed = '[]'::jsonb then 'play_inserted'
    when added = '[]'::jsonb and removed = '[]'::jsonb then 'play_edited'
    else 'plays_changed'
  end;

  det := jsonb_build_object(
    'score_before', old.game_data->'score',
    'score_after', new.game_data->'score',
    'plays_before', old_count,
    'plays_after', new_count
  );
  if added <> '[]'::jsonb then det := det || jsonb_build_object('added', added); end if;
  if removed <> '[]'::jsonb then det := det || jsonb_build_object('removed', removed); end if;
  if changed <> '[]'::jsonb then det := det || jsonb_build_object('changed', changed); end if;
  if meta <> '{}'::jsonb then det := det || jsonb_build_object('meta', meta); end if;

  insert into public.rr_game_audit (game_id, team_id, team_name, game_label, actor_id, actor_email, action, details)
  values (new.id, new.team_id, tname, glabel, actor, actor_mail, act, det);
  return new;
end;
$$;

revoke all on function public.rr_games_audit() from public, anon, authenticated;

-- Site admins can read any game (for the audit log's player names and the
-- change history page). They still can't edit games they aren't on.
create policy "rr_games: site admins read"
  on public.rr_games for select to authenticated
  using (public.rr_is_site_admin());

create trigger rr_games_audit
  after insert or update or delete on public.rr_games
  for each row execute function public.rr_games_audit();
