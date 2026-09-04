import { useEffect, useRef, useState } from 'react';

/**
 * Client-side pagination over a full array.
 * Pass `resetKey` (e.g. serialized filters) to jump back to page 1 whenever
 * the underlying dataset changes identity.
 */
export function usePagination<T>(items: T[] | undefined, pageSize = 10, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const prevResetKey = useRef(resetKey);

  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const total = items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * size;
  const slice = (items ?? []).slice(start, start + size);

  return {
    page: safePage,
    setPage,
    onPageChange: setPage,
    pageSize: size,
    setPageSize: (s: number) => {
      setSize(s);
      setPage(1);
    },
    totalPages,
    total,
    from: total === 0 ? 0 : start,
    to: start + slice.length,
    slice,
  };
}
