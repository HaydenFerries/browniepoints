-- =============================================================================
-- Brownie Points: suspend / reject accounts instead of only deleting them
--
-- status: pending → approved, or rejected; approved ↔ suspended.
-- Rejected and suspended people can still sign in, but they only see a screen
-- explaining why (with the admin's optional note). They can't use the app or
-- read any couple data. Admins can restore them at any time.
-- =============================================================================

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending', 'approved', 'suspended', 'rejected'));
alter table public.profiles add column if not exists status_note text not null default ''
  check (char_length(status_note) <= 300);
alter table public.profiles add column if not exists status_changed_at timestamptz;

-- Only approved members can read couple data (RLS policies use this).
create or replace function public.my_couple_id() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.profiles where id = auth.uid() and status = 'approved'
$$;

create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Please sign in again.';
  end if;
  if p.status = 'pending' then
    raise exception 'Your account is still waiting for approval.';
  elsif p.status = 'suspended' then
    raise exception 'Your account is suspended.';
  elsif p.status = 'rejected' then
    raise exception 'Your sign-up wasn''t approved.';
  end if;
  return p;
end $$;

-- Same as before, but the admin's note is only for its owner, never the partner.
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
    'partner', case when partner.id is null then null
                    else to_jsonb(partner) - 'pair_code' - 'status_note' end,
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
             'status_note', p.status_note,
             'status_changed_at', p.status_changed_at,
             'is_admin', p.is_admin,
             'email', u.email,
             'created_at', p.created_at,
             'last_sign_in_at', u.last_sign_in_at,
             'email_confirmed_at', u.email_confirmed_at,
             'partner_name', (select q.display_name from public.profiles q
                              where q.couple_id = p.couple_id and q.id <> p.id))
           order by case p.status when 'pending' then 0 when 'approved' then 1 else 2 end,
                    p.created_at desc)
    from public.profiles p
    join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

-- Approve, reject, suspend or restore. p_note is shown to the person
-- (cleared when they're approved).
create or replace function public.admin_set_status(p_user uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._admin();
begin
  if p_status not in ('approved', 'suspended', 'rejected') then
    raise exception 'Unknown status.';
  end if;
  if p_user = me.id then
    raise exception 'You can''t change your own account status.';
  end if;
  update public.profiles
     set status = p_status,
         status_note = case when p_status = 'approved' then '' else left(trim(coalesce(p_note, '')), 300) end,
         status_changed_at = now()
   where id = p_user;
  if not found then
    raise exception 'That account doesn''t exist any more.';
  end if;
end $$;

revoke execute on function public.admin_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_status(uuid, text, text) to authenticated;
