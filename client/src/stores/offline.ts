import { create } from 'zustand';
import { api, getToken } from '@/lib/api';
import { getLastSync, getOfflineCache, touchLastSync } from '@/lib/offlineCache';

export type PendingOpType = 'invoice.create' | 'invoice.return' | 'reservation.create';

export interface PendingOp {
  id: string;
  op: PendingOpType;
  payload: any;
  createdAt: string;
}

export interface FailedOp extends PendingOp {
  error: string;
  status: 'conflict' | 'rejected';
}

export interface SyncReport {
  syncedAt: string;
  applied: number;
  failed: number;
}

interface OfflineState {
  pending: PendingOp[];
  failures: FailedOp[];
  lastReport: SyncReport | null;
  online: boolean;
  syncing: boolean;
  lastSync: string | null;
  syncNow: () => Promise<SyncReport | null>;
  pushPending: (op: PendingOp['op'], payload: any) => void;
  pendingCount: () => number;
  removePending: (id: string) => void;
  removeFailure: (id: string) => void;
  retryFailure: (id: string) => void;
  clearAll: () => void;
}

const PENDING_KEY = 'jewelry_offline_ops';
const FAILURES_KEY = 'jewelry_offline_failures';

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function deviceId(): string {
  try {
    return navigator.userAgent;
  } catch {
    return 'unknown';
  }
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  pending: load(PENDING_KEY),
  failures: load(FAILURES_KEY),
  lastReport: null,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  lastSync: getLastSync() ?? getOfflineCache()?.syncedAt ?? null,
  pushPending: (op, payload) => {
    const item: PendingOp = {
      id: crypto.randomUUID(),
      op,
      payload,
      createdAt: new Date().toISOString(),
    };
    const pending = [...get().pending, item];
    persist(PENDING_KEY, pending);
    set({ pending });
  },
  pendingCount: () => get().pending.length,
  removePending: (id) => {
    const pending = get().pending.filter((p) => p.id !== id);
    persist(PENDING_KEY, pending);
    set({ pending });
  },
  removeFailure: (id) => {
    const failures = get().failures.filter((f) => f.id !== id);
    persist(FAILURES_KEY, failures);
    set({ failures });
  },
  retryFailure: (id) => {
    const f = get().failures.find((x) => x.id === id);
    if (!f) return;
    const failures = get().failures.filter((x) => x.id !== id);
    persist(FAILURES_KEY, failures);
    const pending = [...get().pending, { id: f.id, op: f.op, payload: f.payload, createdAt: f.createdAt }];
    persist(PENDING_KEY, pending);
    set({ failures, pending });
  },
  clearAll: () => {
    persist(PENDING_KEY, []);
    persist(FAILURES_KEY, []);
    set({ pending: [], failures: [] });
  },
  syncNow: async () => {
    const pending = get().pending;
    if (pending.length === 0 || !navigator.onLine || !getToken()) return null;
    set({ syncing: true });
    try {
      const results = await api<{ results: { opId: string; status: string; error?: string; invoiceNo?: string }[] }>(
        '/api/sync/outbox',
        { method: 'POST', body: { ops: pending.map((p) => ({ deviceId: deviceId(), opId: p.id, op: p.op, payload: p.payload })) } },
      );

      const byId = new Map(pending.map((p) => [p.id, p]));
      const applied: string[] = [];
      const failed: FailedOp[] = [];
      for (const r of results.results) {
        const p = byId.get(r.opId);
        if (!p) continue;
        if (r.status === 'applied') {
          applied.push(r.opId);
        } else {
          failed.push({ ...p, error: r.error || 'sync.failed', status: r.status === 'conflict' ? 'conflict' : 'rejected' });
        }
      }
      const appliedSet = new Set(applied);
      const remaining = pending.filter((p) => !appliedSet.has(p.id));
      const failures = [...get().failures, ...failed];
      const report: SyncReport = { syncedAt: new Date().toISOString(), applied: applied.length, failed: failed.length };
      const ts = report.syncedAt;
      touchLastSync(ts);
      persist(PENDING_KEY, remaining);
      persist(FAILURES_KEY, failures);
      set({ pending: remaining, failures, lastReport: report, lastSync: ts, syncing: false, online: true });
      return report;
    } catch (e) {
      set({ syncing: false });
      throw e;
    }
  },
}));

// Keep the online flag in sync with the browser's network state.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useOfflineStore.setState({ online: true }));
  window.addEventListener('offline', () => useOfflineStore.setState({ online: false }));
}
