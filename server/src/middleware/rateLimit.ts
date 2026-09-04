import { Request, Response, NextFunction } from 'express';

interface Entry {
  count: number;
  resetAt: number;
}

// Simple in-memory fixed-window rate limiter (single-instance deployment).
const store = new Map<string, Entry>();

export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}|${req.path}`;
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate.limited' });
    }
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, e] of store) {
    if (e.resetAt <= now) store.delete(key);
  }
}, 60_000);
