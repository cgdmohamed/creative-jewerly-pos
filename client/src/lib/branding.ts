import type { AppSettings } from './types';

export const DEFAULT_STORE_NAME = 'محل السبائك والمشغولات';

export function storeName(settings?: Pick<AppSettings, 'store_name'>): string {
  return settings?.store_name?.trim() || DEFAULT_STORE_NAME;
}
