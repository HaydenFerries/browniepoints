-- =============================================================================
-- Brownie Points: shared tasks, timed tasks, pausing, personal ordering,
-- and locking wishes once they've been priced.
--
-- Shared tasks ("either of us"): one partner proposes it with a price for each
-- of them; it only goes live once the other agrees (or counters, and the first
-- agrees). Either can then do it and earns their own price. Any edit needs
-- agreement again.
--
-- Timed tasks: worth full price when fresh, then lose value linearly over
-- decay_hours down to decay_floor_pct of the price. "Warming it up" (bump)
-- makes it fresh again. Repeatable timed tasks freshen when completed.
-- =============================================================================

alter table public.tasks alter column assigned_to drop not null;
alter table public.tasks add column if not exists shared boolean not null default false;
alter table public.tasks add column if not exists points_other int check (points_other between 1 and 1000);
alter table public.tasks add column if not exists awaiting uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists active boolean not null default true;
alter table public.tasks add column if not exists decay_hours int check (decay_hours between 1 and 2160);
alter table public.tasks add column if not exists decay_floor_pct int not null default 25 check (decay_floor_pct between 0 and 90);
alter table public.tasks add column if not exists bumped_at timestamptz not null default now();
alter table public.tasks drop constraint if exists tasks_shape_check;
alter table public.tasks add constraint tasks_shape_check check (
  (not shared and assigned_to is not null) or (shared and assigned_to is null and points_other is not null)
);

-- Each person's own drag-and-drop order of tasks.
alter table public.profiles add column if not exists task_order uuid[] not null default '{}';

-- ----------------------------------------------------------------------------
-- What a task is worth right now to a given person.
-- Shared: `points` is the creator's price, `points_other` the partner's.
-- ----------------------------------------------------------------------------
create or replace function public._task_value(t public.tasks, who uuid) returns int
language plpgsql stable set search_path = public as $$
declare
  base  int := case when t.shared and who <> t.created_by then t.points_other else t.points end;
  fresh numeric;
  fl    numeric := t.decay_floor_pct / 100.0;
begin
  if t.decay_hours is null then
    return base;
  end if;
  fresh := greatest(0, 1 - extract(epoch from (now() - t.bumped_at)) / (t.decay_hours * 3600.0));
  return greatest(1, round(base * (fl + (1 - fl) * fresh)))::int;
end $$;

-- Who may bump / pause a task: the setter for a regular task, either partner
-- for a shared one.
create or replace function public._can_manage(t public.tasks, who uuid) returns boolean
language sql immutable as $$
  select t.shared or t.created_by = who
$$;

create or replace function public._check_task(p_title text, p_points int, p_decay_hours int, p_decay_floor int) returns void
language plpgsql immutable as $$
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'Give the task a name (up to 80 characters).';
  end if;
  if p_points is null or p_points not between 1 and 1000 then
    raise exception 'Tasks can be worth 1 to 1,000 brownies.';
  end if;
  if p_decay_hours is not null and p_decay_hours not between 1 and 2160 then
    raise exception 'Tasks can take up to 90 days to go stale.';
  end if;
  if p_decay_floor is not null and p_decay_floor not between 0 and 90 then
    raise exception 'The lowest value has to be between 0%% and 90%%.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Creating and editing
--   p_partner_points: what your partner earns for doing it
--   p_my_points:      what you earn (shared tasks only)
-- ----------------------------------------------------------------------------
create or replace function public.create_task(
  p_title text, p_details text, p_shared boolean, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  tid     uuid;
begin
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  if coalesce(p_shared, false) then
    perform public._check_task(p_title, p_my_points, null, null);
    insert into public.tasks (couple_id, created_by, assigned_to, shared, title, details, points, points_other,
                              awaiting, repeatable, decay_hours, decay_floor_pct)
    values (me.couple_id, me.id, null, true, trim(p_title), trim(coalesce(p_details, '')), p_my_points, p_partner_points,
            partner, coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'shared_proposed', trim(p_title), p_partner_points, null, partner, '');
  else
    insert into public.tasks (couple_id, created_by, assigned_to, title, details, points,
                              repeatable, decay_hours, decay_floor_pct)
    values (me.couple_id, me.id, partner, trim(p_title), trim(coalesce(p_details, '')), p_partner_points,
            coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'task_added', trim(p_title), p_partner_points, null, partner, '');
  end if;
  return tid;
end $$;

create or replace function public.edit_task(
  p_task_id uuid, p_title text, p_details text, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles := public._me();
  partner uuid := public._partner_id(me);
  t       public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  if t.shared then
    perform public._check_task(p_title, p_my_points, null, null);
    -- store prices relative to the creator; any change needs the partner's OK
    update public.tasks
       set title = trim(p_title), details = trim(coalesce(p_details, '')),
           points = case when me.id = t.created_by then p_my_points else p_partner_points end,
           points_other = case when me.id = t.created_by then p_partner_points else p_my_points end,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), awaiting = partner, updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'shared_changed', trim(p_title), p_partner_points, null, partner, '');
  else
    if t.created_by <> me.id then raise exception 'Only the person who set a task can change it.'; end if;
    update public.tasks
       set title = trim(p_title), details = trim(coalesce(p_details, '')), points = p_partner_points,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'task_updated', trim(p_title), p_partner_points, null, t.assigned_to, '');
  end if;
end $$;

-- Agree to (or decline) a shared task that's waiting on you.
-- To counter-offer, call edit_task with your prices instead.
create or replace function public.respond_shared_task(p_task_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found or not t.shared then raise exception 'That proposal isn''t around any more.'; end if;
  if t.awaiting is distinct from me.id then raise exception 'This one isn''t waiting on you.'; end if;
  if p_accept then
    update public.tasks set awaiting = null, bumped_at = now(), updated_at = now() where id = t.id;
    perform public._log(me.couple_id, me.id, 'shared_agreed', t.title, null, null, null, '');
  else
    update public.tasks set status = 'archived', updated_at = now() where id = t.id;
    perform public._log(me.couple_id, me.id, 'shared_declined', t.title, null, null, null, '');
  end if;
end $$;

create or replace function public.set_task_active(p_task_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  if not public._can_manage(t, me.id) then raise exception 'Only the person who set a task can pause it.'; end if;
  if t.active = coalesce(p_active, true) then return; end if;
  update public.tasks
     set active = coalesce(p_active, true),
         bumped_at = case when p_active then now() else bumped_at end,
         updated_at = now()
   where id = t.id;
  perform public._log(me.couple_id, me.id, case when p_active then 'task_resumed' else 'task_paused' end,
                      t.title, null, null, null, '');
end $$;

create or replace function public.bump_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  if t.decay_hours is null then raise exception 'That task doesn''t go stale.'; end if;
  if not public._can_manage(t, me.id) then raise exception 'Only the person who set a task can warm it up.'; end if;
  update public.tasks set bumped_at = now(), updated_at = now() where id = t.id;
  perform public._log(me.couple_id, me.id, 'task_bumped', t.title, null, null, null, '');
end $$;

create or replace function public.set_task_order(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
begin
  update public.profiles set task_order = coalesce(p_ids[1:500], '{}') where id = me.id;
end $$;

-- ----------------------------------------------------------------------------
-- Updated: claiming, reviewing, removing (shared + timed + paused aware)
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
    elsif t.decay_hours is not null then
      update public.tasks set bumped_at = now() where id = t.id; -- done, so it starts fresh again
    end if;
    perform public._log(me.couple_id, me.id, 'task_approved', t.title, cl.points, cl.points, cl.claimed_by, n);
  else
    update public.task_claims set status = 'declined', resolved_at = now() where id = cl.id;
    perform public._log(me.couple_id, me.id, 'task_declined', t.title, cl.points, null, cl.claimed_by, n);
  end if;
end $$;

create or replace function public.remove_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status <> 'archived' for update;
  if not found then return; end if;
  if not public._can_manage(t, me.id) then raise exception 'Only the person who set a task can remove it.'; end if;
  update public.task_claims set status = 'withdrawn', resolved_at = now() where task_id = t.id and status = 'pending';
  update public.tasks set status = 'archived', updated_at = now() where id = t.id;
  perform public._log(me.couple_id, me.id, 'task_removed', t.title, t.points, null, t.assigned_to, '');
end $$;

-- The old single-purpose editor shouldn't touch shared tasks.
create or replace function public.update_task(p_task_id uuid, p_title text, p_details text, p_points int, p_repeatable boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  t  public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open';
  if not found then raise exception 'That task isn''t around any more.'; end if;
  perform public.edit_task(p_task_id, p_title, p_details, p_points,
                           case when t.shared then t.points else null end,
                           p_repeatable, t.decay_hours, t.decay_floor_pct);
end $$;

-- ----------------------------------------------------------------------------
-- Wishes are locked once your partner has priced them.
-- ----------------------------------------------------------------------------
create or replace function public.update_reward(p_reward_id uuid, p_title text, p_details text, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public._me();
  r  public.rewards;
begin
  select * into r from public.rewards where id = p_reward_id and couple_id = me.couple_id and not archived for update;
  if not found then raise exception 'That reward isn''t around any more.'; end if;
  if r.wished_by <> me.id then raise exception 'Only the person who wished for this can change it.'; end if;
  if r.price is not null then
    raise exception 'This wish has been priced, so it''s locked. Remove it and add a new one to change it.';
  end if;
  update public.rewards
     set title = trim(p_title), details = trim(coalesce(p_details, '')), emoji = coalesce(nullif(trim(p_emoji), ''), emoji)
   where id = r.id;
  perform public._log(me.couple_id, me.id, 'reward_updated', trim(p_title), r.price, null, null, '');
end $$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke execute on function
  public._task_value(public.tasks, uuid), public._can_manage(public.tasks, uuid),
  public._check_task(text, int, int, int)
  from public, anon, authenticated;
revoke execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int),
  public.respond_shared_task(uuid, boolean), public.set_task_active(uuid, boolean),
  public.bump_task(uuid), public.set_task_order(uuid[])
  from public, anon;
grant execute on function
  public.create_task(text, text, boolean, int, int, boolean, int, int),
  public.edit_task(uuid, text, text, int, int, boolean, int, int),
  public.respond_shared_task(uuid, boolean), public.set_task_active(uuid, boolean),
  public.bump_task(uuid), public.set_task_order(uuid[])
  to authenticated;
