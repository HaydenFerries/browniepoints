// Task pricing rules shared by the UI and the demo backend. They mirror
// public._task_value / public._can_manage in the database.
import type { Task, UUID } from './types';

/** The full (fresh) price of a task for this person. */
export function basePrice(t: Task, who: UUID): number {
  return t.shared && who !== t.created_by ? (t.points_other ?? t.points) : t.points;
}

/** 1 = fresh out of the oven, 0 = fully stale. Untimed tasks are always 1. */
export function freshness(t: Task, now = Date.now()): number {
  if (!t.decay_hours) return 1;
  const hours = (now - Date.parse(t.bumped_at ?? t.created_at)) / 3_600_000;
  return Math.max(0, 1 - hours / t.decay_hours);
}

/** What the task is worth to this person right now. */
export function taskValue(t: Task, who: UUID, now = Date.now()): number {
  const base = basePrice(t, who);
  if (!t.decay_hours) return base;
  const floor = (t.decay_floor_pct ?? 25) / 100;
  return Math.max(1, Math.round(base * (floor + (1 - floor) * freshness(t, now))));
}

/** The lowest a timed task can drop to for this person. */
export function floorValue(t: Task, who: UUID): number {
  return Math.max(1, Math.round(basePrice(t, who) * ((t.decay_floor_pct ?? 25) / 100)));
}

/** Who may warm up / pause / remove: the setter, or either of you for shared tasks. */
export const canManage = (t: Task, who: UUID) => !!t.shared || t.created_by === who;

export const isActive = (t: Task) => t.active !== false;

/** Hours → "1 day", "3 days", "1 week"… */
export function durationLabel(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Sort by your saved drag order; tasks you haven't ordered yet go first, newest first. */
export function inOrder<T extends { id: UUID; created_at: string }>(items: T[], order: UUID[] | undefined): T[] {
  const pos = new Map((order ?? []).map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const pa = pos.get(a.id);
    const pb = pos.get(b.id);
    if (pa === undefined && pb === undefined) return b.created_at.localeCompare(a.created_at);
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    return pa - pb;
  });
}
