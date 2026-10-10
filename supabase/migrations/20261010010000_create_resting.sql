-- =============================================================================
-- Brownie Points: tasks can be created already resting (paused), so you can
-- pre-make them and switch them on when they're relevant.
--
-- Same function as before with one extra argument, p_active (default true).
-- The old version is dropped so calls without p_active still resolve to this.
-- =============================================================================

drop function if exists public.create_task(text, text, boolean, int, int, boolean, int, int);

create or replace function public.create_task(
  p_title text, p_details text, p_shared boolean, p_partner_points int, p_my_points int,
  p_repeatable boolean, p_decay_hours int, p_decay_floor int, p_active boolean default true
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
                              awaiting, repeatable, decay_hours, decay_floor_pct, active)
    values (me.couple_id, me.id, null, true, trim(p_title), trim(coalesce(p_details, '')), p_my_points, p_partner_points,
            partner, coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), coalesce(p_active, true))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'shared_proposed', trim(p_title), p_partner_points, null, partner, '');
  else
    insert into public.tasks (couple_id, created_by, assigned_to, title, details, points,
                              repeatable, decay_hours, decay_floor_pct, active)
    values (me.couple_id, me.id, partner, trim(p_title), trim(coalesce(p_details, '')), p_partner_points,
            coalesce(p_repeatable, false), p_decay_hours, coalesce(p_decay_floor, 25), coalesce(p_active, true))
    returning id into tid;
    perform public._log(me.couple_id, me.id, 'task_added', trim(p_title), p_partner_points, null, partner, '');
  end if;
  return tid;
end $$;

revoke execute on function public.create_task(text, text, boolean, int, int, boolean, int, int, boolean) from public, anon;
grant execute on function public.create_task(text, text, boolean, int, int, boolean, int, int, boolean) to authenticated;
