import { ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

function pagesWindow(totalPages: number, page: number): (number | '…')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push('…');
  out.push(totalPages);
  return out;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  from,
  to,
  pageSize,
  onPageSizeChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  total: number;
  from: number;
  to: number;
  pageSize?: number;
  onPageSizeChange?: (s: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const btn =
    'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold transition-colors';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3',
        className,
      )}
    >
      <div className="text-xs text-slate-500">
        عرض {from + 1}–{to} من {total}
      </div>

      <div className="flex items-center gap-1">
        <button
          className={cn(btn, page <= 1 ? 'cursor-not-allowed text-slate-300' : 'text-slate-600 hover:bg-slate-200')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="السابق"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {pagesWindow(totalPages, page).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1 text-xs text-slate-400">…</span>
          ) : (
            <button
              key={p}
              className={cn(
                btn,
                p === page
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200',
              )}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          className={cn(
            btn,
            page >= totalPages ? 'cursor-not-allowed text-slate-300' : 'text-slate-600 hover:bg-slate-200',
          )}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="التالي"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {onPageSizeChange && pageSize != null && (
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-600 focus:border-brand-500 focus:outline-none"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n} / صفحة</option>
          ))}
        </select>
      )}
    </div>
  );
}
