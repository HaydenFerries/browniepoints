import { useState } from 'react';

/** useState that survives reloads within the tab (e.g. which sub-tab is open). */
export function useSessionState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (sessionStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      sessionStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}
