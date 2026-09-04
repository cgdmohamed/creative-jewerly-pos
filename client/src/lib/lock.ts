const KEY = 'jewelry_locked';

// Screen lock state is persisted so a page refresh while locked keeps the
// device locked (the idle-lock is in-memory only and would otherwise reset).
export function isScreenLocked(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setScreenLocked(v: boolean) {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
