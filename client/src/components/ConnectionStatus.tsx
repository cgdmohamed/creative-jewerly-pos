import { useEffect, useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import { useOfflineStore } from '@/stores/offline';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const HEALTH_INTERVAL_MS = 30_000;

type Status = 'ok' | 'offline' | 'server_down';

// Always-visible strip telling the cashier whether this device is online and
// reachable to the server, whether a sync is running, and when data was last synced.
export default function ConnectionStatus() {
  const browserOnline = useOfflineStore((s) => s.online);
  const syncing = useOfflineStore((s) => s.syncing);
  const lastSync = useOfflineStore((s) => s.lastSync);
  const pending = useOfflineStore((s) => s.pending.length);
  const [serverOk, setServerOk] = useState(true);

  useEffect(() => {
    if (!browserOnline) {
      setServerOk(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        await api('/api/health');
        if (!cancelled) setServerOk(true);
      } catch {
        if (!cancelled) setServerOk(false);
      }
    };
    void check();
    const iv = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [browserOnline]);

  const status: Status = !browserOnline ? 'offline' : serverOk ? 'ok' : 'server_down';

  const styles: Record<Status, { cls: string; dot: string; text: string }> = {
    ok: {
      cls: 'border-emerald-100 bg-emerald-50 text-emerald-800',
      dot: 'bg-emerald-500',
      text: 'متصل',
    },
    offline: {
      cls: 'border-rose-100 bg-rose-50 text-rose-700',
      dot: 'animate-pulse bg-rose-500',
      text: 'غير متصل — يعمل وضع دون اتصال',
    },
    server_down: {
      cls: 'border-amber-100 bg-amber-50 text-amber-800',
      dot: 'animate-pulse bg-amber-500',
      text: 'متصل بالإنترنت لكن الخادم غير متاح',
    },
  };

  const s = styles[status];
  const time = lastSync
    ? new Date(lastSync).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div
      className={cn(
        'sticky top-14 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-4 py-1.5 text-xs font-bold md:top-0',
        s.cls,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5">
        <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', s.dot)} />
        {s.text}
      </span>

      {pending > 0 && (
        <span className="flex items-center gap-1">
          <CloudUpload className="h-3 w-3" />
          {pending} عملية قيد الانتظار
        </span>
      )}

      <span className="ms-auto flex items-center gap-1.5 opacity-80">
        {syncing ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            جارٍ المزامنة…
          </>
        ) : (
          <>آخر مزامنة: {time}</>
        )}
      </span>
    </div>
  );
}
