-- =============================================================================
-- Brownie Points: offline sync + push notifications
--
-- Offline sync
--   * Every change from the app goes through apply_op(op_id, name, args, base).
--     op_id makes retries safe: an op that already succeeded just returns its
--     earlier result. (A failed op rolls back and can be retried.)
--   * tasks/rewards get a version that goes up when someone edits what the
--     user sees (title, prices, timing…). An edit queued offline carries the
--     version it was based on; if your partner changed it since, apply_op
--     refuses with a CONFLICT so the app can ask "keep theirs / use mine".
--   * create_task/add_reward made offline keep the id the phone gave them.
--   * claim_task accepts when the task was really done (p_done_at), so a
--     timed task done offline earns what it was worth then (within limits).
--
-- Push notifications
--   * push_subscriptions holds each phone's Web Push address. Only the owner
--     can save/remove theirs; the send-push Edge Function reads them with the
--     service role.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Versions for edit conflicts
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists version int not null default 1;
alter table public.tasks add column if not exists last_editor uuid;
alter table public.rewards add column if not exists version int not null default 1;
alter table public.rewards add column if not exists last_editor uuid;

create or replace function public._bump_task_version() returns trigger
language plpgsql as $$
begin
  if (new.title, new.details, new.points, new.points_other, new.repeatable, new.shared, new.decay_hours,
      new.decay_floor_pct, new.decay_grace_hours, new.stale_points, new.stale_points_other, new.sleep_hours)
     is distinct from
     (old.title, old.details, old.points, old.points_other, old.repeatable, old.shared, old.decay_hours,
      old.decay_floor_pct, old.decay_grace_hours, old.stale_points, old.stale_points_other, old.sleep_hours) then
    new.version := old.version + 1;
    new.last_editor := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists tasks_version on public.tasks;
create trigger tasks_version before update on public.tasks
  for each row execute function public._bump_task_version();

create or replace function public._bump_reward_version() returns trigger
language plpgsql as $$
begin
  if (new.title, new.details, new.emoji, new.price) is distinct from (old.title, old.details, old.emoji, old.price) then
    new.version := old.version + 1;
    new.last_editor := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists rewards_version on public.rewards;
create trigger rewards_version before update on public.rewards
  for each row execute function public._bump_reward_version();

-- ----------------------------------------------------------------------------
-- What a task was worth at a given moment (claims done offline)
-- ----------------------------------------------------------------------------
create or replace function public._task_value_at(t public.tasks, who uuid, at timestamptz) returns int
language plpgsql stable set search_path = public as $$
declare
  other   boolean := t.shared and who <> t.created_by;
  base    int := case when other then t.points_other else t.points end;
  stale   numeric := coalesce(case when other then t.stale_points_other else t.stale_points end,
                              base * t.decay_floor_pct / 100.0);
  elapsed numeric;
  fresh   numeric;
begin
  if t.decay_hours is null then
    return base;
  end if;
  elapsed := extract(epoch from (at - t.bumped_at)) / 3600.0 - t.decay_grace_hours;
  fresh := greatest(0, least(1, 1 - elapsed / (t.decay_hours - t.decay_grace_hours)));
  return greatest(1, round(stale + (base - stale) * fresh))::int;
end $$;

create or replace function public._task_value(t public.tasks, who uuid) returns int
language sql stable set search_path = public as $$
  select public._task_value_at(t, who, now())
$$;

drop function if exists public.claim_task(uuid, text);

create or replace function public.claim_task(p_task_id uuid, p_note text, p_done_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles := public._me();
  t   public.tasks;
  val int;
  at  timestamptz;
begin
  perform public._partner_id(me);
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id for update;
  if not found or t.status <> 'open' then raise exception 'That task isn''t available any more.'; end if;
  if t.shared then
    if t.awaiting is not null then raise exception 'You both need to agree on this one first.'; end if;
  elsif t.assigned_to <> me.id then
    raise exception 'This task is for your partner, not you.';
  end if;
  if not t.active then raise exception 'That task is resting right now.'; end if;
  if t.sleeping_until > now() then raise exception 'That task is sleeping. It''ll be back soon.'; end if;
  if exists (select 1 from public.task_claims where task_id = t.id and status = 'pending') then
    raise exception 'Already marked as done. Waiting on approval.';
  end if;
  -- done offline: value it at when it was done (not in the future, at most 48h ago)
  at := greatest(least(coalesce(p_done_at, now()), now()), now() - interval '48 hours');
  val := public._task_value_at(t, me.id, at);
  insert into public.task_claims (couple_id, task_id, claimed_by, points, note)
  values (me.couple_id, t.id, me.id, val, left(trim(coalesce(p_note, '')), 300));
  perform public._log(me.couple_id, me.id, 'task_claimed', t.title, val, null, me.id, left(trim(coalesce(p_note, '')), 300));
end $$;

-- ----------------------------------------------------------------------------
-- apply_op: one idempotent door for every change the app makes
-- ----------------------------------------------------------------------------
create table if not exists public.applied_ops (
  op_id      uuid primary key,
  user_id    uuid not null,
  name       text not null,
  result     jsonb,
  applied_at timestamptz not null default now()
);
create index if not exists applied_ops_age_idx on public.applied_ops (applied_at);
alter table public.applied_ops enable row level security;

create or replace function public.apply_op(p_op_id uuid, p_name text, p_args jsonb, p_base jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  a       jsonb := coalesce(p_args, '{}'::jsonb);
  r       jsonb := 'null'::jsonb;
  prior   jsonb;
  cur_v   int;
  cur_by  uuid;
  who     text;
begin
  select result into prior from public.applied_ops where op_id = p_op_id and user_id = me.id;
  if found then
    return coalesce(prior, 'null'::jsonb); -- already done (a retry)
  end if;

  -- edits made offline: refuse if the partner changed it since
  if p_base is not null and p_base ? 'id' then
    if p_base->>'table' = 'tasks' then
      select version, last_editor into cur_v, cur_by from public.tasks
       where id = (p_base->>'id')::uuid and couple_id = me.couple_id;
    elsif p_base->>'table' = 'rewards' then
      select version, last_editor into cur_v, cur_by from public.rewards
       where id = (p_base->>'id')::uuid and couple_id = me.couple_id;
    end if;
    if cur_v is not null and cur_v <> (p_base->>'version')::int and cur_by is distinct from me.id then
      select display_name into who from public.profiles where id = cur_by;
      raise exception 'CONFLICT: % changed this since', coalesce(who, 'Your partner');
    end if;
  end if;

  case p_name
    when 'update_profile' then
      perform public.update_profile(a->>'p_display_name', a->>'p_avatar');
    when 'create_task' then
      r := to_jsonb(public.create_task(
        a->>'p_title', a->>'p_details', (a->>'p_shared')::boolean, (a->>'p_partner_points')::int,
        (a->>'p_my_points')::int, (a->>'p_repeatable')::boolean, (a->>'p_decay_hours')::int,
        (a->>'p_decay_floor')::int, coalesce((a->>'p_active')::boolean, true),
        coalesce((a->>'p_decay_grace')::int, 0), (a->>'p_stale_partner')::int, (a->>'p_stale_mine')::int,
        (a->>'p_sleep_hours')::int));
      if a ? 'p_id' then -- made offline: keep the id the phone gave it, so queued edits find it
        update public.tasks set id = (a->>'p_id')::uuid where id = (r#>>'{}')::uuid;
        r := to_jsonb((a->>'p_id')::uuid);
      end if;
    when 'edit_task' then
      perform public.edit_task(
        (a->>'p_task_id')::uuid, a->>'p_title', a->>'p_details', (a->>'p_partner_points')::int,
        (a->>'p_my_points')::int, (a->>'p_repeatable')::boolean, (a->>'p_decay_hours')::int,
        (a->>'p_decay_floor')::int, coalesce((a->>'p_decay_grace')::int, 0), (a->>'p_stale_partner')::int,
        (a->>'p_stale_mine')::int, (a->>'p_active')::boolean, (a->>'p_shared')::boolean,
        case when a ? 'p_sleep_hours' then (a->>'p_sleep_hours')::int else -1 end);
    when 'respond_shared_task' then
      perform public.respond_shared_task((a->>'p_task_id')::uuid, (a->>'p_accept')::boolean);
    when 'set_task_active' then
      perform public.set_task_active((a->>'p_task_id')::uuid, (a->>'p_active')::boolean);
    when 'bump_task' then
      perform public.bump_task((a->>'p_task_id')::uuid);
    when 'set_task_order' then
      perform public.set_task_order(array(select jsonb_array_elements_text(coalesce(a->'p_ids', '[]'::jsonb)))::uuid[]);
    when 'remove_task' then
      perform public.remove_task((a->>'p_task_id')::uuid);
    when 'claim_task' then
      perform public.claim_task((a->>'p_task_id')::uuid, a->>'p_note', (a->>'p_done_at')::timestamptz);
    when 'withdraw_claim' then
      perform public.withdraw_claim((a->>'p_claim_id')::uuid);
    when 'review_claim' then
      perform public.review_claim((a->>'p_claim_id')::uuid, (a->>'p_approve')::boolean, a->>'p_note');
    when 'add_reward' then
      r := to_jsonb(public.add_reward(a->>'p_title', a->>'p_details', a->>'p_emoji'));
      if a ? 'p_id' then
        update public.rewards set id = (a->>'p_id')::uuid where id = (r#>>'{}')::uuid;
        r := to_jsonb((a->>'p_id')::uuid);
      end if;
    when 'update_reward' then
      perform public.update_reward((a->>'p_reward_id')::uuid, a->>'p_title', a->>'p_details', a->>'p_emoji');
    when 'remove_reward' then
      perform public.remove_reward((a->>'p_reward_id')::uuid);
    when 'price_reward' then
      perform public.price_reward((a->>'p_reward_id')::uuid, (a->>'p_price')::int);
    when 'redeem_reward' then
      r := to_jsonb(public.redeem_reward((a->>'p_reward_id')::uuid));
    when 'cancel_redemption' then
      perform public.cancel_redemption((a->>'p_redemption_id')::uuid);
    when 'deliver_redemption' then
      perform public.deliver_redemption((a->>'p_redemption_id')::uuid);
    when 'gift_brownies' then
      perform public.gift_brownies((a->>'p_amount')::int, a->>'p_note');
    else
      raise exception 'Unknown action.';
  end case;

  insert into public.applied_ops (op_id, user_id, name, result) values (p_op_id, me.id, p_name, r);
  delete from public.applied_ops where applied_at < now() - interval '30 days'; -- keep it small
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- Push subscriptions
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'Please sign in again.';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' then
    raise exception 'That doesn''t look like a push address.';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.applied_ops, public.push_subscriptions from anon, authenticated;
-- the send-push Edge Function reads these with the service role
grant select, delete on public.push_subscriptions to service_role;
grant select on public.profiles to service_role;
revoke execute on function
  public._bump_task_version(), public._bump_reward_version(),
  public._task_value_at(public.tasks, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function
  public.claim_task(uuid, text, timestamptz),
  public.apply_op(uuid, text, jsonb, jsonb),
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text)
  from public, anon;
grant execute on function
  public.claim_task(uuid, text, timestamptz),
  public.apply_op(uuid, text, jsonb, jsonb),
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text)
  to authenticated;
