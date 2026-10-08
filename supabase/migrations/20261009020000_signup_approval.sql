-- =============================================================================
-- Brownie Points: invite-only sign-ups + admin portal
--
-- New accounts start as 'pending'. A pending account can sign in, but every
-- app function refuses it until an admin approves it, so it can't pair, see
-- anyone, or create anything. Admins approve or remove accounts from the app.
--
-- Accounts that existed before this migration are kept as 'approved'.
--
-- Make yourself an admin once (SQL Editor), using the email you signed up with:
--   update public.profiles set is_admin = true, status = 'approved'
--   where id = (select id from auth.users where email = 'you@example.com');
-- =============================================================================

-- Existing rows get 'approved'; new rows default to 'pending'.
alter table public.profiles
  add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved'));
alter table public.profiles alter column status set default 'pending';
alter table public.profiles add column if not exists is_admin boolean not null default false;
create index if not exists profiles_pending_idx on public.profiles (created_at) where status = 'pending';

-- ----------------------------------------------------------------------------
-- Guards
-- ----------------------------------------------------------------------------
-- Every app function goes through _me(), so this one check locks pending
-- accounts out of everything.
create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Please sign in again.';
  end if;
  if p.status <> 'approved' then
    raise exception 'Your account is still waiting for approval.';
  end if;
  return p;
end $$;

create or replace function public._admin() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles := public._me();
begin
  if not p.is_admin then
    raise exception 'Only admins can do that.';
  end if;
  return p;
end $$;

-- ----------------------------------------------------------------------------
-- get_state: works for pending accounts too (so the app can show the waiting
-- screen), but they only ever get their own profile back.
-- ----------------------------------------------------------------------------
create or replace function public.get_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me      public.profiles;
  partner public.profiles;
  c       uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Please sign in again.';
  end if;
  if me.status <> 'approved' then
    return jsonb_build_object(
      'me', to_jsonb(me) - 'pair_code', 'partner', null,
      'tasks', '[]'::jsonb, 'claims', '[]'::jsonb, 'rewards', '[]'::jsonb,
      'redemptions', '[]'::jsonb, 'activity', '[]'::jsonb,
      'balances', '{}'::jsonb, 'earned', '{}'::jsonb, 'admin', null);
  end if;
  c := me.couple_id;
  if c is not null then
    select * into partner from public.profiles p where p.couple_id = c and p.id <> me.id;
  end if;
  return jsonb_build_object(
    'me', to_jsonb(me),
    'partner', case when partner.id is null then null else to_jsonb(partner) - 'pair_code' end,
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from public.tasks t where t.couple_id = c and t.status <> 'archived'), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select * from public.task_claims where couple_id = c order by created_at desc limit 200) x), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.rewards r where r.couple_id = c and not r.archived), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select d.*, r.title, r.emoji
            from public.redemptions d join public.rewards r on r.id = d.reward_id
            where d.couple_id = c order by d.created_at desc limit 200) x), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.id desc)
      from (select * from public.activity where couple_id = c order by id desc limit 200) x), '[]'::jsonb),
    'balances', coalesce((
      select jsonb_object_agg(beneficiary_id, total)
      from (select beneficiary_id, sum(delta)::int as total from public.activity
            where couple_id = c and delta is not null and beneficiary_id is not null
            group by beneficiary_id) b), '{}'::jsonb),
    'earned', coalesce((
      select jsonb_object_agg(beneficiary_id, total)
      from (select beneficiary_id, sum(delta)::int as total from public.activity
            where couple_id = c and delta > 0 and kind in ('task_approved', 'gift')
            group by beneficiary_id) b), '{}'::jsonb),
    'admin', case when me.is_admin
      then jsonb_build_object('pending', (select count(*) from public.profiles where status = 'pending'))
      else null end
  );
end $$;

-- Profile edits and new codes are for approved members only.
create or replace function public.update_profile(p_display_name text, p_avatar text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  n  text := trim(coalesce(p_display_name, ''));
begin
  if char_length(n) = 0 or char_length(n) > 40 then
    raise exception 'Names need to be between 1 and 40 characters.';
  end if;
  update public.profiles
     set display_name = n,
         avatar = coalesce(nullif(left(trim(p_avatar), 16), ''), avatar)
   where id = me.id;
end $$;

create or replace function public.new_pair_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  me   public.profiles := public._me();
  code text := public.generate_pair_code();
begin
  update public.profiles set pair_code = code where id = me.id;
  return code;
end $$;

-- Same as before, plus: you can't pair with an account that isn't approved
-- (it looks exactly like a wrong code, so pending accounts can't be probed).
create or replace function public.pair_with(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me    public.profiles;
  other public.profiles;
  cid   uuid;
  norm  text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
begin
  me := public._me();
  if me.couple_id is not null then
    return jsonb_build_object('ok', false, 'error', 'You''re already paired up.');
  end if;
  if (select count(*) from public.pair_attempts
      where user_id = me.id and created_at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many tries. Take a breather and try again in a few minutes.');
  end if;

  select * into other from public.profiles
   where replace(pair_code, '-', '') = norm and status = 'approved'
   for update;
  if not found then
    insert into public.pair_attempts (user_id) values (me.id);
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t match anyone. Double-check it?');
  end if;
  if other.id = me.id then
    return jsonb_build_object('ok', false, 'error', 'That''s your own code! Send it to your partner instead.');
  end if;
  if other.couple_id is not null then
    return jsonb_build_object('ok', false, 'error', 'That person is already paired with someone.');
  end if;

  select id into cid from public.couples
   where member_a = least(me.id, other.id) and member_b = greatest(me.id, other.id);
  if cid is null then
    insert into public.couples (member_a, member_b)
    values (least(me.id, other.id), greatest(me.id, other.id))
    returning id into cid;
  end if;

  update public.profiles set couple_id = cid where id in (me.id, other.id);
  perform public._log(cid, me.id, 'paired', '', null, null, other.id, '');
  return jsonb_build_object('ok', true, 'couple_id', cid);
end $$;

-- ----------------------------------------------------------------------------
-- Admin portal
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'display_name', p.display_name,
             'avatar', p.avatar,
             'status', p.status,
             'is_admin', p.is_admin,
             'email', u.email,
             'created_at', p.created_at,
             'last_sign_in_at', u.last_sign_in_at,
             'email_confirmed_at', u.email_confirmed_at,
             'partner_name', (select q.display_name from public.profiles q
                              where q.couple_id = p.couple_id and q.id <> p.id))
           order by (p.status = 'pending') desc, p.created_at desc)
    from public.profiles p
    join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

create or replace function public.admin_approve(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin();
  update public.profiles set status = 'approved' where id = p_user and status = 'pending';
end $$;

-- Deletes the account and everything it created. Their partner (if any) is
-- unpaired first so they can pair with someone else.
create or replace function public.admin_remove_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me     public.profiles := public._admin();
  victim public.profiles;
begin
  if p_user = me.id then
    raise exception 'You can''t remove your own account from here.';
  end if;
  select * into victim from public.profiles where id = p_user;
  if not found then
    return;
  end if;
  if victim.couple_id is not null then
    perform public._log(victim.couple_id, null, 'unpaired', '', null, null, null, '');
    update public.profiles
       set couple_id = null, pair_code = public.generate_pair_code()
     where couple_id = victim.couple_id;
  end if;
  delete from auth.users where id = p_user;
end $$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke execute on function public._admin() from public, anon, authenticated;
revoke execute on function
  public.admin_list_users(), public.admin_approve(uuid), public.admin_remove_user(uuid)
  from public, anon;
grant execute on function
  public.admin_list_users(), public.admin_approve(uuid), public.admin_remove_user(uuid)
  to authenticated;
-- re-created above; keep the original grants explicit
revoke execute on function
  public._me(), public.get_state(), public.update_profile(text, text),
  public.new_pair_code(), public.pair_with(text)
  from public, anon;
revoke execute on function public._me() from authenticated;
grant execute on function
  public.get_state(), public.update_profile(text, text), public.new_pair_code(), public.pair_with(text)
  to authenticated;
