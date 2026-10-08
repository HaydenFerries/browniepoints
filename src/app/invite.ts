// Invite links look like …/#join=FUDGE-7K2QX. The code is kept (in the URL
// fragment, which never reaches a server) until the visitor has an account and
// can be paired.
const KEY = 'bp-invite';

export function captureInviteFromUrl() {
  const m = location.hash.match(/join=([A-Za-z0-9-]+)/);
  if (!m) return;
  try {
    localStorage.setItem(KEY, decodeURIComponent(m[1]).toUpperCase());
  } catch {
    /* storage unavailable */
  }
  history.replaceState(null, '', location.pathname + location.search);
}

export function readInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
