create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('coach', 'player')),
  share_stats boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists public.shared_game_stats (
  team_id uuid not null,
  user_id uuid not null,
  games_played integer not null check (games_played >= 0),
  minutes_total integer not null check (minutes_total >= 0),
  points_total integer not null check (points_total >= 0),
  rebounds_total integer not null check (rebounds_total >= 0),
  assists_total integer not null check (assists_total >= 0),
  steals_total integer not null check (steals_total >= 0),
  blocks_total integer not null check (blocks_total >= 0),
  turnovers_total integer not null check (turnovers_total >= 0),
  fg_made_total integer not null check (fg_made_total >= 0),
  fg_attempted_total integer not null check (fg_attempted_total >= fg_made_total),
  three_made_total integer not null check (three_made_total >= 0),
  three_attempted_total integer not null check (three_attempted_total >= three_made_total),
  ft_made_total integer not null check (ft_made_total >= 0),
  ft_attempted_total integer not null check (ft_attempted_total >= ft_made_total),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (team_id, user_id)
    references public.team_members (team_id, user_id) on delete cascade
);

create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists team_invites_team_idx on public.team_invites (team_id);
create unique index if not exists team_invites_one_unrevoked_per_team
  on public.team_invites (team_id)
  where revoked_at is null;

create or replace function public.is_team_member(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where team_id = target_team and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_coach(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where team_id = target_team and user_id = auth.uid() and role = 'coach'
  );
$$;

create or replace function public.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid() or exists (
    select 1
    from public.team_members mine
    join public.team_members teammate on teammate.team_id = mine.team_id
    where mine.user_id = auth.uid() and teammate.user_id = target_user
  );
$$;

create or replace function public.can_view_shared_stats(target_team uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members viewer
    join public.team_members player
      on player.team_id = viewer.team_id
    where viewer.team_id = target_team
      and viewer.user_id = auth.uid()
      and viewer.role = 'coach'
      and player.user_id = target_user
      and player.share_stats
  );
$$;

create or replace function public.is_stats_sharing_enabled(target_team uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where team_id = target_team
      and user_id = target_user
      and user_id = auth.uid()
      and share_stats
  );
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Jogador'), 60)
  )
  on conflict (id) do update
    set display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para criar um time.';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'O nome do time deve ter entre 1 e 80 caracteres.';
  end if;

  insert into public.teams (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, role)
  values (new_team_id, auth.uid(), 'coach');

  return new_team_id;
end;
$$;

create or replace function public.create_team_invite(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite_token text;
  invite_id uuid;
begin
  if auth.uid() is null or not public.is_team_coach(p_team_id) then
    raise exception 'Somente o treinador do time pode criar convites.';
  end if;

  update public.team_invites
  set revoked_at = now()
  where team_id = p_team_id and revoked_at is null;

  invite_token := replace(
    replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'),
    '/',
    '_'
  );

  insert into public.team_invites (
    team_id, token_hash, created_by, expires_at
  )
  values (
    p_team_id,
    encode(extensions.digest(invite_token, 'sha256'), 'hex'),
    auth.uid(),
    now() + interval '14 days'
  )
  returning id into invite_id;

  return jsonb_build_object('id', invite_id, 'token', invite_token);
end;
$$;

create or replace function public.join_team_by_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invited_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.';
  end if;
  if p_token is null or char_length(p_token) not between 40 and 60 then
    raise exception 'Este link de convite é inválido.';
  end if;

  select team_id into invited_team_id
  from public.team_invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now()
  for update;

  if invited_team_id is null then
    raise exception 'Este convite expirou, foi revogado ou não existe.';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (invited_team_id, auth.uid(), 'player')
  on conflict (team_id, user_id) do nothing;

  return invited_team_id;
end;
$$;

create or replace function public.revoke_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_invites
  set revoked_at = now()
  where id = p_invite_id
    and revoked_at is null
    and public.is_team_coach(team_id);

  if not found then
    raise exception 'Convite não encontrado ou você não tem permissão para revogá-lo.';
  end if;
end;
$$;

create or replace function public.set_team_stats_sharing(p_team_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members
  set share_stats = p_enabled
  where team_id = p_team_id and user_id = auth.uid();

  if not found then
    raise exception 'Você não faz parte deste time.';
  end if;

  if not p_enabled then
    delete from public.shared_game_stats
    where team_id = p_team_id and user_id = auth.uid();
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.shared_game_stats enable row level security;

drop policy if exists profiles_view_teammates on public.profiles;
create policy profiles_view_teammates on public.profiles
for select to authenticated
using (public.can_view_profile(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists teams_view_members on public.teams;
create policy teams_view_members on public.teams
for select to authenticated
using (public.is_team_member(id));

drop policy if exists team_members_view_teammates on public.team_members;
create policy team_members_view_teammates on public.team_members
for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists shared_game_stats_view_opted_in on public.shared_game_stats;
create policy shared_game_stats_view_opted_in on public.shared_game_stats
for select to authenticated
using (
  user_id = auth.uid()
  or public.can_view_shared_stats(team_id, user_id)
);

drop policy if exists shared_game_stats_insert_self on public.shared_game_stats;
create policy shared_game_stats_insert_self on public.shared_game_stats
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_stats_sharing_enabled(team_id, user_id)
);

drop policy if exists shared_game_stats_update_self on public.shared_game_stats;
create policy shared_game_stats_update_self on public.shared_game_stats
for update to authenticated
using (
  user_id = auth.uid()
  and public.is_stats_sharing_enabled(team_id, user_id)
)
with check (
  user_id = auth.uid()
  and public.is_stats_sharing_enabled(team_id, user_id)
);

drop policy if exists shared_game_stats_delete_self on public.shared_game_stats;
create policy shared_game_stats_delete_self on public.shared_game_stats
for delete to authenticated
using (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.teams to authenticated;
grant select on public.team_members to authenticated;
grant select, insert, update, delete on public.shared_game_stats to authenticated;

revoke all on function public.is_team_member(uuid) from public;
revoke all on function public.is_team_coach(uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;
revoke all on function public.can_view_shared_stats(uuid, uuid) from public;
revoke all on function public.is_stats_sharing_enabled(uuid, uuid) from public;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.create_team(text) from public;
revoke all on function public.create_team_invite(uuid) from public;
revoke all on function public.join_team_by_invite(text) from public;
revoke all on function public.revoke_team_invite(uuid) from public;
revoke all on function public.set_team_stats_sharing(uuid, boolean) from public;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_coach(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_view_shared_stats(uuid, uuid) to authenticated;
grant execute on function public.is_stats_sharing_enabled(uuid, uuid) to authenticated;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.create_team_invite(uuid) to authenticated;
grant execute on function public.join_team_by_invite(text) to authenticated;
grant execute on function public.revoke_team_invite(uuid) to authenticated;
grant execute on function public.set_team_stats_sharing(uuid, boolean) to authenticated;
