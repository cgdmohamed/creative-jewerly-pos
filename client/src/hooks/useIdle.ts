import { useEffect, useRef, useState } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointerdown'] as const;

// Returns true after `timeoutMs` without user activity (pointer/keyboard/touch).
// Paused when `enabled` is false (e.g. while the lock screen is already shown).
export function useIdle(timeoutMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      setIdle(false);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIdle(true), timeoutMs);
    };

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [timeoutMs, enabled]);

  return idle;
}
