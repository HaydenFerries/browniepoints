-- =============================================================================
-- Brownie Points: editing a task can also set whether it's live or resting
-- (p_active, default null = leave as it is), so a shared proposal can be
-- switched to "starts resting" before it's agreed. Switching a resting task
-- live makes it fresh, same as resuming it.
-- =============================================================================

drop function if exists public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int);

create or replace function public.edit_task(
  p_task_id uuid, p_title text, p_details text, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_decay_grace int default 0,
  p_stale_partner int default null, p_stale_mine int default null, p_active boolean default null
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
begin
  select * into t from public.tasks where id = p_task_id and couple_id = me.couple_id and status = 'open' for update;
  if not found then raise exception 'That task isn''t around any more.'; end if;
  perform public._check_task(p_title, p_partner_points, p_decay_hours, p_decay_floor);
  perform public._check_grace(p_decay_hours, grace);
  perform public._check_stale(s_part, p_partner_points);
  live := coalesce(p_active, t.active);
  waking := live and not t.active;
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
           active = live, bumped_at = case when waking then now() else bumped_at end,
           awaiting = partner, updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'shared_changed', trim(p_title), p_partner_points, null, partner, '');
  else
    if t.created_by <> me.id then raise exception 'Only the person who set a task can change it.'; end if;
    update public.tasks
       set title = trim(p_title), details = trim(coalesce(p_details, '')), points = p_partner_points,
           repeatable = coalesce(p_repeatable, false), decay_hours = p_decay_hours,
           decay_floor_pct = coalesce(p_decay_floor, 25), decay_grace_hours = grace, stale_points = s_part,
           active = live, bumped_at = case when waking then now() else bumped_at end,
           updated_at = now()
     where id = t.id;
    perform public._log(me.couple_id, me.id, 'task_updated', trim(p_title), p_partner_points, null, t.assigned_to, '');
  end if;
end $$;

revoke execute on function public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.edit_task(uuid, text, text, int, int, boolean, int, int, int, int, int, boolean) to authenticated;
