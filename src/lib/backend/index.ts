import { createDemoBackend } from './demo';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';

export type { Backend } from './types';

const FORCE_DEMO_KEY = 'bp-force-demo';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const supabaseConfigured = Boolean(url && key && !url.includes('your-project-ref'));

/** Real backend when Supabase is configured, unless the visitor chose the demo. */
export function createBackend(): Backend {
  if (supabaseConfigured && localStorage.getItem(FORCE_DEMO_KEY) !== '1') {
    return createSupabaseBackend(url!, key!);
  }
  return createDemoBackend();
}

export function enterDemo() {
  localStorage.setItem(FORCE_DEMO_KEY, '1');
}

export function leaveDemo() {
  localStorage.removeItem(FORCE_DEMO_KEY);
}
