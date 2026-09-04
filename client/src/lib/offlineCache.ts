import { api, getToken } from '@/lib/api';
import type { AppSettings, Customer, Item, Location, PriceRow } from '@/lib/types';

export interface OfflineCache {
  items: Item[];
  prices: PriceRow[];
  locations: Location[];
  settings: AppSettings;
  customers: Customer[];
  syncedAt: string;
}

const KEY = 'jewelry_offline_cache';
const LAST_SYNC_KEY = 'jewelry_last_sync';

export function getLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

export function touchLastSync(ts = new Date().toISOString()) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, ts);
  } catch {
    /* ignore */
  }
}

export function getOfflineCache(): OfflineCache | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveOfflineCache(data: OfflineCache) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

// Pull the reference dataset from the server and store it for offline use.
// Best-effort: never throws — the app keeps running even if the pull fails.
export async function refreshOfflineCache(): Promise<void> {
  if (!navigator.onLine || !getToken()) return;
  try {
    const data = await api<OfflineCache>('/api/sync/pull');
    saveOfflineCache(data);
    touchLastSync(data.syncedAt);
  } catch {
    /* ignore — offline cache stays stale until a successful pull */
  }
}

// Fallback used by data hooks when a network call fails while offline.
export function offlineFallback<K extends keyof OfflineCache>(key: K): OfflineCache[K] | undefined {
  return getOfflineCache()?.[key];
}
