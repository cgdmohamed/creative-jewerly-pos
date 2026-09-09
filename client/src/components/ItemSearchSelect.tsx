import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Item } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ItemSearchSelectProps {
  items: Item[];
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  showLocation?: boolean;
}

function itemLabel(item: Item, showLocation: boolean) {
  const title = item.name ? `${item.code} - ${item.name}` : item.code;
  return showLocation && item.locationName ? `${title} (${item.locationName})` : title;
}

export function ItemSearchSelect({
  items,
  value,
  onChange,
  placeholder = 'ابحث بالكود أو الباركود أو الاسم...',
  showLocation = false,
}: ItemSearchSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = items.find((item) => String(item.id) === String(value ?? ''));

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    const filtered = normalized
      ? items.filter((item) => [
        item.code,
        item.barcode,
        item.name,
        item.categoryName,
        item.locationName,
      ].some((field) => String(field ?? '').toLocaleLowerCase('ar').includes(normalized)))
      : items;
    return filtered.slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => setActiveIndex(0), [query]);

  const choose = (item: Item) => {
    onChange(String(item.id));
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div ref={rootRef} className="relative">
      <div className={cn(
        'flex h-10 items-center rounded-lg border bg-white transition',
        open ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-300',
      )}>
        <Search className="mr-3 h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? query : selected ? itemLabel(selected, showLocation) : ''}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(0, Math.min(index + 1, matches.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setQuery('');
              inputRef.current?.blur();
            }
          }}
        />
        {selected ? (
          <button
            type="button"
            title="مسح الاختيار"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 hover:text-rose-600"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
        )}
      </div>

      {open && (
        <div role="listbox" className="absolute z-[70] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          {matches.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={String(item.id) === String(value ?? '')}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-right transition',
                index === activeIndex ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900">{item.code}</span>
                  <span className="truncate text-sm text-slate-700">{item.name || 'بدون اسم'}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                  {item.barcode && <span dir="ltr">{item.barcode}</span>}
                  {item.categoryName && <span>{item.categoryName}</span>}
                  {showLocation && item.locationName && <span>{item.locationName}</span>}
                  <span>متاح {item.availableQty ?? 1}</span>
                </div>
              </div>
              {String(item.id) === String(value ?? '') && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-slate-400">لا توجد قطعة مطابقة</div>
          )}
          {items.length > 50 && !query.trim() && (
            <div className="border-t px-3 py-2 text-center text-[11px] text-slate-400">
              اكتب للبحث في {items.length} قطعة
            </div>
          )}
        </div>
      )}
    </div>
  );
}
