-- =============================================================================
-- Brownie Points: tasks that sleep after they're done, and switching a task
-- between "for your partner" and "either of us" when editing it.
--
-- sleep_hours (repeatable tasks): after a completion is approved the task
--   null → ready again straight away
--   0    → rests until someone switches it back on
--   n    → sleeps for n hours (sleeping_until), then wakes up fresh by itself
--
-- create_task gains p_sleep_hours (default null). edit_task gains p_shared
-- (default null = keep) and p_sleep_hours (default -1 = keep).
-- =============================================================================

alter table public.tasks add column if not exists sleep_hours int check (sleep_hours between 0 and 2160);
alter table public.tasks add column if not exists sleeping_until timestamptz;

-- ----------------------------------------------------------------------------
-- create_task
-- ----------------------------------------------------------------------------
drop function if exists public.create_task(text, text, boolean, int, int, boolean, int, int, boolean, int, int, int);

create or replace function public.create_task(
  p_title text, p_details text, p_shared boolean, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_active boolean default true,
  p_decay_grace int default 0, p_stale_partner int default null, p_stale_mine int default null,
  p_sleep_hours int default null
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
  sleep   int := case when coalesce(p_repeatable, false) then p_sleep_hours end;
begin
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  perform public._check_grace(p_decay_hours, grace);
  perform public._check_stale(s_part, p_partner_points);
  if sleep is not null and sleep not between 0 and 2160 then
    raise exception 'Tasks can sleep for up to 90 days.';
  end if;
  if coalesce(p_shared, false) then
    perform public._check_task(p_title, p_my_points, null, null);
    perform public._check_stale(s_mine, p_my_points);
    insert into public.tasks (couple_id, created_by, assigned_to, shared, title, details, points, points_other,
                              awaiting, repeatable, decay_hours, decay_floor_pct, decay_grace_hours,
                              stale_points, stale_points_other, active, sleep_hours)
    values (me.couple_id, me.id, null, true, trim(p_title), trim(coalesce(p_details, '')), p_my_points, p_partner_points,
            partner, coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), grace,
            s_mine, s_part, coalesce(p_active, true), sleep)
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'shared_proposed', trim(p_title), p_partner_points, null, partner, '');
  else
    insert into public.tasks (couple_id, created_by, assigned_to, title, details, points,
                              repeatable, decay_hours, decay_floor_pct, decay_grace_hours, stale_points, active, sleep_hours)
    values (me.couple_id, me.id, partner, trim(p_title), trim(coalesce(p_details, '')), p_partner_points,
            coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), grace, s_part,
            coalesce(p_active, true), sleep)
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'task_added', trim(p_title), p_partner_points, null, partner, '');
  end if;
  return tid;
end $$;

-- ----------------------------------------------------------------------------
-- edit_task: can now also switch regular ↔ shared (creator only) and set sleep
-- ----------------------------------------------------------------------------
drop function if exists public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int, boolean);

create or replace function public.edit_task(
  p_task_id uuid, p_title text, p_details text, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_decay_grace int default 0,
  p_stale_partner int default null, p_stale_mine int default null, p_active boolean default null,
  p_shared boolean default null, p_sleep_hours int default -1
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
  live    boolean;
  waking  boolean;
  to_shared boolean;
  sleep   int;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  to_shared := coalesce(p_shared, t.shared);
  if to_shared <> t.shared then
    if t.created_by <> me.id then
      raise exception 'Only the person who set a task can change who does it.';
    end if;
    if exists (select 1 from public.task_claims where task_id = t.id and status = 'pending') then
      raise exception 'Someone''s marked this as done. Approve or send it back first.';
    end if;
  end if;
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  perform public._check_grace(p_decay_hours, grace);
  perform public._check_stale(s_part, p_partner_points);
  sleep := case when not coalesce(p_repeatable, false) then null
                when p_sleep_hours = -1 then t.sleep_hours
                else p_sleep_hours end;
  if sleep is not null and sleep not between 0 and 2160 then
    raise exception 'Tasks can sleep for up to 90 days.';
  end if;
  live := coalesce(p_active, t.active);
  waking := live and not t.active;
  if to_shared then
    perform public._check_task(p_title, p_my_points, null, null);
    perform public._check_stale(s_mine, p_my_points);
    -- prices are stored relative to the creator; any change needs the partner's OK
    update public.tasks
       set shared = true, assigned_to = null,
           title = trim(p_title), details = trim(coalesce(p_details, '')),
           points = case when me.id = t.created_by then p_my_points else p_partner_points end,
           points_other = case when me.id = t.created_by then p_partner_points else p_my_points end,
           stale_points = case when me.id = t.created_by then s_mine else s_part end,
           stale_points_other = case when me.id = t.created_by then s_part else s_mine end,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), decay_grace_hours = grace, sleep_hours = sleep,
           active = live, bumped_at = case when waking then now() else bumped_at end,
           awaiting = partner, updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, case when t.shared then 'shared_changed' else 'shared_proposed' end,
                        trim(p_title), p_partner_points, null, partner, '');
  else
    if t.created_by <> me.id then raise exception 'Only the person who set a task can change it.'; end if;
    update public.tasks
       set shared = false, assigned_to = partner, points_other = null, stale_points_other = null, awaiting = null,
           title = trim(p_title), details = trim(coalesce(p_details, '')), points = p_partner_points,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), decay_grace_hours = grace, stale_points = s_part,
           sleep_hours = sleep, active = live, bumped_at = case when waking then now() else bumped_at end,
           updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'task_updated', trim(p_title), p_partner_points, null, partner, '');
  end if;
end $$;

-- The old single-purpose editor keeps everything else as it was.
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

-- ----------------------------------------------------------------------------
-- Claiming is blocked while asleep; approving a repeatable task puts it to sleep
-- ----------------------------------------------------------------------------
create or replace function public.claim_task(p_task_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles := public._me();
  t   public.tasks;
  val int;
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
  val := public._task_value(t, me.id);
  insert into public.task_claims (couple_id, task_id, claimed_by, points, note)
  values (me.couple_id, t.id, me.id, val, left(trim(coalesce(p_note, '')), 300));
  perform public._log(me.couple_id, me.id, 'task_claimed', t.title, val, null, me.id, left(trim(coalesce(p_note, '')), 300));
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
    elsif t.sleep_hours = 0 then
      update public.tasks set active = false, updated_at = now() where id = t.id;      -- rests until switched on
    elsif t.sleep_hours > 0 then
      update public.tasks                                                                -- sleeps, wakes up fresh
         set sleeping_until = now() + make_interval(hours => t.sleep_hours),
             bumped_at = now() + make_interval(hours => t.sleep_hours), updated_at = now()
       where id = t.id;
    elsif t.decay_hours is not null then
      update public.tasks set bumped_at = now() where id = t.id;                         -- fresh again now
    end if;
    perform public._log(me.couple_id, me.id, 'task_approved', t.title, cl.points, cl.points, cl.claimed_by, n);
  else
    update public.task_claims set status = 'declined', resolved_at = now() where id = cl.id;
    perform public._log(me.couple_id, me.id, 'task_declined', t.title, cl.points, null, cl.claimed_by, n);
  end if;
end $$;

-- Switching a task on also wakes it if it's sleeping.
create or replace function public.set_task_active(p_task_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me     public.profiles := public._me();
  t      public.tasks;
  on_    boolean := coalesce(p_active, true);
  asleep boolean;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  if not public._can_manage(t, me.id) then raise exception 'Only the person who set a task can pause it.'; end if;
  asleep := t.sleeping_until > now();
  if t.active = on_ and not (on_ and asleep) then return; end if;
  update public.tasks
     set active = on_,
         sleeping_until = case when on_ then null else sleeping_until end,
         bumped_at = case when on_ then now() else bumped_at end,
         updated_at = now()
   where id = t.id;
  perform public._log(me.couple_id, me.id, case when on_ then 'task_resumed' else 'task_paused' end,
                      t.title, null, null, null, '');
end $$;

revoke execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int, boolean, int, int, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int, boolean, boolean, int)
  from public, anon;
grant execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int, boolean, int, int, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int, boolean, boolean, int)
  to authenticated;
