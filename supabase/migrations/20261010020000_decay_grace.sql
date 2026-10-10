-- =============================================================================
-- Brownie Points: timed tasks can stay at full price for a while before they
-- start cooling (decay_grace_hours), then slide to a stale price by decay_hours.
-- The stale price is a brownie amount (stale_points / stale_points_other, like
-- points / points_other); older tasks without one still use decay_floor_pct.
--
--   0 ──── grace ──────────── decay_hours ────▶ time
--   full   full     (linear)   stale      stale
--
-- create_task / edit_task gain p_decay_grace (default 0) and the stale prices
-- p_stale_partner / p_stale_mine (default null). The old versions are dropped
-- so existing calls resolve to the new ones.
-- =============================================================================

alter table public.tasks add column if not exists decay_grace_hours int not null default 0
  check (decay_grace_hours >= 0);
alter table public.tasks add column if not exists stale_points int check (stale_points >= 1);
alter table public.tasks add column if not exists stale_points_other int check (stale_points_other >= 1);
alter table public.tasks drop constraint if exists tasks_grace_check;
alter table public.tasks add constraint tasks_grace_check
  check (decay_hours is null or decay_grace_hours < decay_hours);

create or replace function public._task_value(t public.tasks, who uuid) returns int
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
  elapsed := extract(epoch from (now() - t.bumped_at)) / 3600.0 - t.decay_grace_hours;
  fresh := greatest(0, least(1, 1 - elapsed / (t.decay_hours - t.decay_grace_hours)));
  return greatest(1, round(stale + (base - stale) * fresh))::int;
end $$;

create or replace function public._check_grace(p_decay_hours int, p_grace int) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_grace, 0) < 0 or (p_decay_hours is not null and coalesce(p_grace, 0) >= p_decay_hours) then
    raise exception 'It has to start cooling before it goes stale.';
  end if;
end $$;

create or replace function public._check_stale(p_stale int, p_price int) returns void
language plpgsql immutable as $$
begin
  if p_stale is not null and (p_stale < 1 or p_stale >= p_price) then
    raise exception 'The stale price has to be at least 1 and lower than the full price.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- create_task: p_stale_partner = your partner's stale price,
--              p_stale_mine    = yours (shared tasks only)
-- ----------------------------------------------------------------------------
drop function if exists public.create_task(text, text, boolean, int, int, boolean, int, int, boolean);

create or replace function public.create_task(
  p_title text, p_details text, p_shared boolean, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_active boolean default true,
  p_decay_grace int default 0, p_stale_partner int default null, p_stale_mine int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  tid     uuid;
  timed   boolean := p_decay_hours is not null;
  grace   int := case when timed then coalesce(p_decay_grace, 0) else 0 end;
  s_part  int := case when timed then p_stale_partner end;
  s_mine  int := case when timed and coalesce(p_shared, false) then p_stale_mine end;
begin
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  perform public._check_grace(p_decay_hours, grace);
  perform public._check_stale(s_part, p_partner_points);
  if coalesce(p_shared, false) then
    perform public._check_task(p_title, p_my_points, null, null);
    perform public._check_stale(s_mine, p_my_points);
    insert into public.tasks (couple_id, created_by, assigned_to, shared, title, details, points, points_other,
                              awaiting, repeatable, decay_hours, decay_floor_pct, decay_grace_hours,
                              stale_points, stale_points_other, active)
    values (me.couple_id, me.id, null, true, trim(p_title), trim(coalesce(p_details, '')), p_my_points, p_partner_points,
            partner, coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), grace,
            s_mine, s_part, coalesce(p_active, true))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'shared_proposed', trim(p_title), p_partner_points, null, partner, '');
  else
    insert into public.tasks (couple_id, created_by, assigned_to, title, details, points,
                              repeatable, decay_hours, decay_floor_pct, decay_grace_hours, stale_points, active)
    values (me.couple_id, me.id, partner, trim(p_title), trim(coalesce(p_details, '')), p_partner_points,
            coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), grace, s_part,
            coalesce(p_active, true))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'task_added', trim(p_title), p_partner_points, null, partner, '');
  end if;
  return tid;
end $$;

-- ----------------------------------------------------------------------------
-- edit_task: same perspective as create_task
-- ----------------------------------------------------------------------------
drop function if exists public.edit_task(uuid, text, text, int, int, boolean, int, int);

create or replace function public.edit_task(
  p_task_id uuid, p_title text, p_details text, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_decay_grace int default 0,
  p_stale_partner int default null, p_stale_mine int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  t       public.tasks;
  timed   boolean := p_decay_hours is not null;
  grace   int := case when timed then coalesce(p_decay_grace, 0) else 0 end;
  s_part  int := case when timed then p_stale_partner end;
  s_mine  int := case when timed then p_stale_mine end;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  perform public._check_grace(p_decay_hours, grace);
  perform public._check_stale(s_part, p_partner_points);
  if t.shared then
    perform public._check_task(p_title, p_my_points, null, null);
    perform public._check_stale(s_mine, p_my_points);
    -- prices are stored relative to the creator; any change needs the partner's OK
    update public.tasks
       set title = trim(p_title), details = trim(coalesce(p_details, '')),
           points = case when me.id = t.created_by then p_my_points else p_partner_points end,
           points_other = case when me.id = t.created_by then p_partner_points else p_my_points end,
           stale_points = case when me.id = t.created_by then s_mine else s_part end,
           stale_points_other = case when me.id = t.created_by then s_part else s_mine end,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), decay_grace_hours = grace,
           awaiting = partner, updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'shared_changed', trim(p_title), p_partner_points, null, partner, '');
  else
    if t.created_by <> me.id then raise exception 'Only the person who set a task can change it.'; end if;
    update public.tasks
       set title = trim(p_title), details = trim(coalesce(p_details, '')), points = p_partner_points,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), decay_grace_hours = grace, stale_points = s_part,
           updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'task_updated', trim(p_title), p_partner_points, null, t.assigned_to, '');
  end if;
end $$;

-- The old single-purpose editor keeps the task's timing as it was.
create or replace function public.update_task(p_task_id uuid, p_title text, p_details text, p_points int, p_repeatable boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me     public.profiles := public._me();
  t      public.tasks;
  mine   boolean;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open';
  if not found then raise exception 'That task isn''t around any more.'; end if;
  mine := me.id = t.created_by;
  perform public.edit_task(p_task_id, p_title, p_details, p_points,
                           case when t.shared then (case when mine then t.points else t.points_other end) end,
                           p_repeatable, t.decay_hours, t.decay_floor_pct, t.decay_grace_hours,
                           case when t.shared and mine then t.stale_points_other else t.stale_points end,
                           case when t.shared then (case when mine then t.stale_points else t.stale_points_other end) end);
end $$;

revoke execute on function public._check_grace(int, int), public._check_stale(int, int) from public, anon, authenticated;
revoke execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int, boolean, int, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int)
  from public, anon;
grant execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int, boolean, int, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int)
  to authenticated;
