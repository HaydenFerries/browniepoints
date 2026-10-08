-- =============================================================================
-- Brownie Points — database schema
--
-- Run once in Supabase → SQL Editor (or let the GitHub integration apply it).
-- Safe to re-run: tables use IF NOT EXISTS and functions/policies are replaced.
--
-- Security model
--   * Partners can READ everything that belongs to their couple (RLS below).
--   * Nobody writes to tables directly. Every change goes through a
--     SECURITY DEFINER function that checks who is allowed to do it, so a
--     person can never award themselves points or price their own wishes.
--   * Balances are never stored; they are the sum of `activity.delta`.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.couples (
  id         uuid primary key default gen_random_uuid(),
  member_a   uuid not null,               -- least(user ids), lets a couple re-pair
  member_b   uuid not null,               -- greatest(user ids) and keep their history
  created_at timestamptz not null default now(),
  unique (member_a, member_b)
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar       text not null default '🍫' check (char_length(avatar) <= 16),
  pair_code    text not null unique,
  couple_id    uuid references public.couples (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists profiles_couple_idx on public.profiles (couple_id);

-- A task one partner sets for the other. `points` is decided by the setter.
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  assigned_to uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  details     text not null default '' check (char_length(details) <= 500),
  points      int  not null check (points between 1 and 1000),
  repeatable  boolean not null default false,
  status      text not null default 'open' check (status in ('open', 'done', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_couple_idx on public.tasks (couple_id);

-- "I did it!" — waits for the task setter to approve before points move.
create table if not exists public.task_claims (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  claimed_by  uuid not null references public.profiles (id) on delete cascade,
  points      int  not null,
  note        text not null default '',
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists task_claims_one_pending
  on public.task_claims (task_id) where status = 'pending';
create index if not exists task_claims_couple_idx on public.task_claims (couple_id, created_at desc);

-- A reward someone wishes for. The PARTNER sets the price.
create table if not exists public.rewards (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples (id) on delete cascade,
  wished_by  uuid not null references public.profiles (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  details    text not null default '' check (char_length(details) <= 500),
  emoji      text not null default '🎁' check (char_length(emoji) <= 16),
  price      int check (price between 1 and 10000),
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  priced_at  timestamptz
);
create index if not exists rewards_couple_idx on public.rewards (couple_id);

create table if not exists public.redemptions (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,
  reward_id   uuid not null references public.rewards (id) on delete cascade,
  redeemed_by uuid not null references public.profiles (id) on delete cascade,
  price       int  not null,
  status      text not null default 'pending' check (status in ('pending', 'delivered', 'cancelled')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists redemptions_couple_idx on public.redemptions (couple_id, created_at desc);

-- The feed AND the ledger. `delta` (when set) changes `beneficiary_id`'s balance.
create table if not exists public.activity (
  id             bigint generated always as identity primary key,
  couple_id      uuid not null references public.couples (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  kind           text not null,
  title          text not null default '',
  value          int,
  delta          int,
  beneficiary_id uuid references public.profiles (id) on delete set null,
  note           text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists activity_couple_idx on public.activity (couple_id, id desc);
create index if not exists activity_balance_idx on public.activity (couple_id, beneficiary_id) where delta is not null;

-- Failed pairing attempts, to slow down code guessing.
create table if not exists public.pair_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists pair_attempts_user_idx on public.pair_attempts (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Helpers (internal)
-- ----------------------------------------------------------------------------
create or replace function public.my_couple_id() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.profiles where id = auth.uid()
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
  return p;
end $$;

create or replace function public._partner_id(me public.profiles) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  pid uuid;
begin
  if me.couple_id is null then
    raise exception 'Pair up with your partner first.';
  end if;
  select id into pid from public.profiles where couple_id = me.couple_id and id <> me.id;
  if pid is null then
    raise exception 'Your partner isn''t here any more.';
  end if;
  return pid;
end $$;

create or replace function public._log(
  p_couple uuid, p_actor uuid, p_kind text, p_title text,
  p_value int, p_delta int, p_beneficiary uuid, p_note text
) returns void
language sql security definer set search_path = public as $$
  insert into public.activity (couple_id, actor_id, kind, title, value, delta, beneficiary_id, note)
  values (p_couple, p_actor, p_kind, coalesce(p_title, ''), p_value, p_delta, p_beneficiary, coalesce(p_note, ''));
$$;

create or replace function public._balance(p_couple uuid, p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.activity
  where couple_id = p_couple and beneficiary_id = p_user and delta is not null
$$;

-- Codes look like FUDGE-7K2QX: a bakery word + 5 random characters.
create or replace function public.generate_pair_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  words    text[] := array['FUDGE','COCOA','GOOEY','CRUMB','TRUFFLE','CARAMEL','PECAN','MOCHA',
                           'SWIRL','GANACHE','TOFFEE','HAZEL','BUTTER','SUGAR','VELVET','SPRINKLE'];
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b        bytea;
  code     text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    code := words[1 + (get_byte(b, 15) % 16)] || '-';
    for i in 0..4 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.profiles where pair_code = code);
  end loop;
  return code;
end $$;

-- New auth user → profile (name comes from sign-up metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar, pair_code)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40),
    coalesce(nullif(new.raw_user_meta_data ->> 'avatar', ''), '🍫'),
    public.generate_pair_code()
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Reading: one call returns everything the app shows.
-- ----------------------------------------------------------------------------
create or replace function public.get_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me      public.profiles;
  partner public.profiles;
  c       uuid;
begin
  me := public._me();
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
            group by beneficiary_id) b), '{}'::jsonb)
  );
end $$;

-- ----------------------------------------------------------------------------
-- Profile & pairing
-- ----------------------------------------------------------------------------
create or replace function public.update_profile(p_display_name text, p_avatar text) returns void
language plpgsql security definer set search_path = public as $$
declare
  n text := trim(coalesce(p_display_name, ''));
begin
  if char_length(n) = 0 or char_length(n) > 40 then
    raise exception 'Names need to be between 1 and 40 characters.';
  end if;
  update public.profiles
     set display_name = n,
         avatar = coalesce(nullif(left(trim(p_avatar), 16), ''), avatar)
   where id = auth.uid();
end $$;

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

  select * into other from public.profiles where replace(pair_code, '-', '') = norm for update;
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

create or replace function public.unpair() returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
begin
  me := public._me();
  if me.couple_id is null then
    return;
  end if;
  perform public._log(me.couple_id, me.id, 'unpaired', '', null, null, null, '');
  update public.profiles
     set couple_id = null, pair_code = public.generate_pair_code()
   where couple_id = me.couple_id;
end $$;

create or replace function public.new_pair_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := public.generate_pair_code();
begin
  update public.profiles set pair_code = code where id = auth.uid();
  return code;
end $$;

-- ----------------------------------------------------------------------------
-- Tasks
-- ----------------------------------------------------------------------------
create or replace function public.add_task(p_title text, p_details text, p_points int, p_repeatable boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  tid     uuid;
begin
  insert into public.tasks (couple_id, created_by, assigned_to, title, details, points, repeatable)
  values (me.couple_id, me.id, partner, trim(p_title), trim(coalesce(p_details, '')), p_points, coalesce(p_repeatable, false))
  returning id into tid;
  perform public._log(me.couple_id, me.id, 'task_added', trim(p_title), p_points, null, partner, '');
  return tid;
end $$;

create or replace function public.update_task(p_task_id uuid, p_title text, p_details text, p_points int, p_repeatable boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  if t.created_by <> me.id then raise exception 'Only the person who set a task can change it.'; end if;
  update public.tasks
     set title = trim(p_title), details = trim(coalesce(p_details, '')), points = p_points,
         repeatable = coalesce(p_repeatable, false), updated_at = now()
   where id = t.id;
  perform public._log(me.couple_id, me.id, 'task_updated', trim(p_title), p_points, null, t.assigned_to, '');
end $$;

create or replace function public.remove_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status <> 'archived' for update;
  if not found then return; end if;
  if t.created_by <> me.id then raise exception 'Only the person who set a task can remove it.'; end if;
  update public.task_claims set status = 'withdrawn', resolved_at = now() where task_id = t.id and status = 'pending';
  update public.tasks set status = 'archived', updated_at = now() where id = t.id;
  perform public._log(me.couple_id, me.id, 'task_removed', t.title, t.points, null, t.assigned_to, '');
end $$;

create or replace function public.claim_task(p_task_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  perform public._partner_id(me);
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id for update;
  if not found or t.status <> 'open' then raise exception 'That task isn''t available any more.'; end if;
  if t.assigned_to <> me.id then raise exception 'This task is for your partner, not you.'; end if;
  if exists (select 1 from public.task_claims where task_id = t.id and status = 'pending') then
    raise exception 'Already marked as done. Waiting on approval.';
  end if;
  insert into public.task_claims (couple_id, task_id, claimed_by, points, note)
  values (me.couple_id, t.id, me.id, t.points, left(trim(coalesce(p_note, '')), 300));
  perform public._log(me.couple_id, me.id, 'task_claimed', t.title, t.points, null, me.id, left(trim(coalesce(p_note, '')), 300));
end $$;

create or replace function public.withdraw_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  cl public.task_claims;
  t  public.tasks;
begin
  select * into cl from public.task_claims where id = p_claim_id and couple_id = me.couple_id for update;
  if not found or cl.status <> 'pending' then return; end if;
  if cl.claimed_by <> me.id then raise exception 'Only the person who claimed this can undo it.'; end if;
  update public.task_claims set status = 'withdrawn', resolved_at = now() where id = cl.id;
  select * into t from public.tasks where id = cl.task_id;
  perform public._log(me.couple_id, me.id, 'claim_withdrawn', t.title, cl.points, null, me.id, '');
end $$;

create or replace function public.review_claim(p_claim_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  cl public.task_claims;
  t  public.tasks;
  n  text := left(trim(coalesce(p_note, '')), 300);
begin
  select * into cl from public.task_claims where id = p_claim_id and couple_id = me.couple_id for update;
  if not found or cl.status <> 'pending' then raise exception 'That one''s already been reviewed.'; end if;
  if cl.claimed_by = me.id then raise exception 'Nice try! Your partner has to approve your own tasks.'; end if;
  select * into t from public.tasks where id = cl.task_id for update;
  if p_approve then
    update public.task_claims set status = 'approved', resolved_at = now() where id = cl.id;
    if not t.repeatable then
      update public.tasks set status = 'done', updated_at = now() where id = t.id;
    end if;
    perform public._log(me.couple_id, me.id, 'task_approved', t.title, cl.points, cl.points, cl.claimed_by, n);
  else
    update public.task_claims set status = 'declined', resolved_at = now() where id = cl.id;
    perform public._log(me.couple_id, me.id, 'task_declined', t.title, cl.points, null, cl.claimed_by, n);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Rewards
-- ----------------------------------------------------------------------------
create or replace function public.add_reward(p_title text, p_details text, p_emoji text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  rid     uuid;
begin
  insert into public.rewards (couple_id, wished_by, title, details, emoji)
  values (me.couple_id, me.id, trim(p_title), trim(coalesce(p_details, '')), coalesce(nullif(trim(p_emoji), ''), '🎁'))
  returning id into rid;
  perform public._log(me.couple_id, me.id, 'reward_added', trim(p_title), null, null, partner, '');
  return rid;
end $$;

create or replace function public.update_reward(p_reward_id uuid, p_title text, p_details text, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  r  public.rewards;
begin
  select * into r from public.rewards where id = p_reward_id and couple_id = me.couple_id and not archived for update;
  if not found then raise exception 'That reward isn''t around any more.'; end if;
  if r.wished_by <> me.id then raise exception 'Only the person who wished for this can change it.'; end if;
  update public.rewards
     set title = trim(p_title), details = trim(coalesce(p_details, '')), emoji = coalesce(nullif(trim(p_emoji), ''), emoji)
   where id = r.id;
  perform public._log(me.couple_id, me.id, 'reward_updated', trim(p_title), r.price, null, null, '');
end $$;

create or replace function public.remove_reward(p_reward_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  r  public.rewards;
begin
  select * into r from public.rewards where id = p_reward_id and couple_id = me.couple_id and not archived for update;
  if not found then return; end if;
  if r.wished_by <> me.id then raise exception 'Only the person who wished for this can remove it.'; end if;
  if exists (select 1 from public.redemptions where reward_id = r.id and status = 'pending') then
    raise exception 'This one''s been redeemed and is waiting to be delivered. Cancel that first.';
  end if;
  update public.rewards set archived = true where id = r.id;
  perform public._log(me.couple_id, me.id, 'reward_removed', r.title, r.price, null, null, '');
end $$;

create or replace function public.price_reward(p_reward_id uuid, p_price int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  r  public.rewards;
begin
  if p_price is null or p_price < 1 or p_price > 10000 then
    raise exception 'Prices need to be between 1 and 10,000 brownies.';
  end if;
  select * into r from public.rewards where id = p_reward_id and couple_id = me.couple_id and not archived for update;
  if not found then raise exception 'That reward isn''t around any more.'; end if;
  if r.wished_by = me.id then raise exception 'Your partner decides what your wishes cost.'; end if;
  update public.rewards set price = p_price, priced_at = now() where id = r.id;
  perform public._log(me.couple_id, me.id, 'reward_priced', r.title, p_price, null, r.wished_by, '');
end $$;

create or replace function public.redeem_reward(p_reward_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles := public._me();
  r   public.rewards;
  bal int;
  rid uuid;
begin
  perform public._partner_id(me);
  -- serialise redemptions per person so a double-tap can't overspend
  perform 1 from public.profiles where id = me.id for update;
  select * into r from public.rewards where id = p_reward_id and couple_id = me.couple_id and not archived;
  if not found then raise exception 'That reward isn''t available any more.'; end if;
  if r.wished_by <> me.id then raise exception 'You can only redeem rewards from your own wishlist.'; end if;
  if r.price is null then raise exception 'Your partner hasn''t set a price for this yet.'; end if;
  bal := public._balance(me.couple_id, me.id);
  if bal < r.price then
    raise exception 'You need % more brownies for this one.', r.price - bal;
  end if;
  insert into public.redemptions (couple_id, reward_id, redeemed_by, price)
  values (me.couple_id, r.id, me.id, r.price)
  returning id into rid;
  perform public._log(me.couple_id, me.id, 'reward_redeemed', r.title, r.price, -r.price, me.id, '');
  return rid;
end $$;

create or replace function public.cancel_redemption(p_redemption_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  d  public.redemptions;
  r  public.rewards;
begin
  select * into d from public.redemptions where id = p_redemption_id and couple_id = me.couple_id for update;
  if not found or d.status <> 'pending' then return; end if;
  select * into r from public.rewards where id = d.reward_id;
  update public.redemptions set status = 'cancelled', resolved_at = now() where id = d.id;
  perform public._log(me.couple_id, me.id, 'redemption_cancelled', r.title, d.price, d.price, d.redeemed_by, '');
end $$;

create or replace function public.deliver_redemption(p_redemption_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  d  public.redemptions;
  r  public.rewards;
begin
  select * into d from public.redemptions where id = p_redemption_id and couple_id = me.couple_id for update;
  if not found or d.status <> 'pending' then raise exception 'That one''s already been sorted.'; end if;
  if d.redeemed_by = me.id then raise exception 'Your partner marks this as delivered, not you.'; end if;
  select * into r from public.rewards where id = d.reward_id;
  update public.redemptions set status = 'delivered', resolved_at = now() where id = d.id;
  perform public._log(me.couple_id, me.id, 'redemption_delivered', r.title, d.price, null, d.redeemed_by, '');
end $$;

-- A spontaneous treat: give your partner brownies with a note.
create or replace function public.gift_brownies(p_amount int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
begin
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'Gifts can be between 1 and 500 brownies.';
  end if;
  perform public._log(me.couple_id, me.id, 'gift', '', p_amount, p_amount, partner, left(trim(coalesce(p_note, '')), 300));
end $$;

-- ----------------------------------------------------------------------------
-- Row level security: partners can read their couple's rows; no direct writes.
-- ----------------------------------------------------------------------------
alter table public.couples       enable row level security;
alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_claims   enable row level security;
alter table public.rewards       enable row level security;
alter table public.redemptions   enable row level security;
alter table public.activity      enable row level security;
alter table public.pair_attempts enable row level security;

drop policy if exists "couple members read couple" on public.couples;
create policy "couple members read couple" on public.couples
  for select to authenticated using (id = public.my_couple_id());

drop policy if exists "read self and partner" on public.profiles;
create policy "read self and partner" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (couple_id is not null and couple_id = public.my_couple_id()));

drop policy if exists "couple reads tasks" on public.tasks;
create policy "couple reads tasks" on public.tasks
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "couple reads claims" on public.task_claims;
create policy "couple reads claims" on public.task_claims
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "couple reads rewards" on public.rewards;
create policy "couple reads rewards" on public.rewards
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "couple reads redemptions" on public.redemptions;
create policy "couple reads redemptions" on public.redemptions
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "couple reads activity" on public.activity;
create policy "couple reads activity" on public.activity
  for select to authenticated using (couple_id = public.my_couple_id());

-- ----------------------------------------------------------------------------
-- Grants (written out explicitly so "auto-expose new tables" can stay off)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on public.couples, public.profiles, public.tasks, public.task_claims,
              public.rewards, public.redemptions, public.activity, public.pair_attempts
  from anon, authenticated;
grant select on public.couples, public.profiles, public.tasks, public.task_claims,
                public.rewards, public.redemptions, public.activity
  to authenticated;

revoke execute on function
  public.my_couple_id(), public._me(), public._partner_id(public.profiles),
  public._log(uuid, uuid, text, text, int, int, uuid, text), public._balance(uuid, uuid),
  public.generate_pair_code(), public.handle_new_user(), public.get_state(),
  public.update_profile(text, text), public.pair_with(text), public.unpair(), public.new_pair_code(),
  public.add_task(text, text, int, boolean), public.update_task(uuid, text, text, int, boolean),
  public.remove_task(uuid), public.claim_task(uuid, text), public.withdraw_claim(uuid),
  public.review_claim(uuid, boolean, text),
  public.add_reward(text, text, text), public.update_reward(uuid, text, text, text),
  public.remove_reward(uuid), public.price_reward(uuid, int), public.redeem_reward(uuid),
  public.cancel_redemption(uuid), public.deliver_redemption(uuid), public.gift_brownies(int, text)
  from public, anon, authenticated;

grant execute on function
  public.my_couple_id(), public.get_state(),
  public.update_profile(text, text), public.pair_with(text), public.unpair(), public.new_pair_code(),
  public.add_task(text, text, int, boolean), public.update_task(uuid, text, text, int, boolean),
  public.remove_task(uuid), public.claim_task(uuid, text), public.withdraw_claim(uuid),
  public.review_claim(uuid, boolean, text),
  public.add_reward(text, text, text), public.update_reward(uuid, text, text, text),
  public.remove_reward(uuid), public.price_reward(uuid, int), public.redeem_reward(uuid),
  public.cancel_redemption(uuid), public.deliver_redemption(uuid), public.gift_brownies(int, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: partners get a ping whenever the other one does something.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity') then
    alter publication supabase_realtime add table public.activity;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
