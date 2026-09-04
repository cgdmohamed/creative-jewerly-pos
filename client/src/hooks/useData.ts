import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { offlineFallback } from '@/lib/offlineCache';
import type {
  AppSettings, Category, CountItem, Customer, Employee, Invoice, Item, Location, Movement,
  PriceRow, Reservation, Shift, StockCount, StockLimit, PaymentMethod,
} from '@/lib/types';

// True when the server can't be reached (network error, browser offline, or a
// proxy-level 5xx meaning the backend is down) — stale cache beats an error.
function isServerUnreachable(e: any): boolean {
  return e instanceof TypeError || !navigator.onLine || (typeof e?.status === 'number' && e.status >= 500 && e.status <= 504);
}

// Returns cached data (from /api/sync/pull) when the server is unreachable.
async function withOfflineFallback<T>(path: string, key: 'items' | 'prices' | 'locations' | 'customers'): Promise<T> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (isServerUnreachable(e)) {
      const cached = offlineFallback(key);
      if (cached) return cached as T;
    }
    throw e;
  }
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      try {
        return await api<AppSettings>('/api/settings');
      } catch (e) {
        if (isServerUnreachable(e)) {
          const cached = offlineFallback('settings');
          if (cached) return cached;
        }
        throw e;
      }
    },
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api<Pick<AppSettings, 'store_name'>>('/api/settings/public'),
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => withOfflineFallback<Location[]>('/api/locations', 'locations'),
  });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories') });
}

export function useEmployees() {
  return useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/api/employees') });
}

export function useCustomers(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return useQuery({
    queryKey: ['customers', qs],
    queryFn: () => withOfflineFallback<Customer[]>(`/api/customers${qs}`, 'customers'),
  });
}

export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<Customer>(`/api/customers/${id}`),
    enabled: !!id,
  });
}

export function useCustomerInvoices(id: number) {
  return useQuery({
    queryKey: ['customer-invoices', id],
    queryFn: () => api<Invoice[]>(`/api/customers/${id}/invoices`),
    enabled: !!id,
  });
}

export function useCustomerReservations(id: number) {
  return useQuery({
    queryKey: ['customer-reservations', id],
    queryFn: () => api<Reservation[]>(`/api/customers/${id}/reservations`),
    enabled: !!id,
  });
}

export function useItems(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: ['items', qs],
    queryFn: () => withOfflineFallback<Item[]>(`/api/items${qs}`, 'items'),
  });
}

export function useItem(id: number | null) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: () => api<Item>(`/api/items/${id}`),
    enabled: !!id,
  });
}

export function useItemAudit(id: number) {
  return useQuery({
    queryKey: ['item-audit', id],
    queryFn: () =>
      api<{ statuses: any[]; movements: any[]; sales: any[]; reservations: any[] }>(
        `/api/items/${id}/audit`,
      ),
  });
}

export function useActivePrices() {
  return useQuery({
    queryKey: ['prices-active'],
    queryFn: () => withOfflineFallback<PriceRow[]>('/api/prices/active', 'prices'),
  });
}

export function usePriceHistory() {
  return useQuery({
    queryKey: ['prices-history'],
    queryFn: () => api<PriceRow[]>('/api/prices/history'),
  });
}

export function useMovements(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({ queryKey: ['movements', qs], queryFn: () => api<Movement[]>(`/api/movements${qs}`) });
}

export function useStockCounts() {
  return useQuery({ queryKey: ['stock-counts'], queryFn: () => api<StockCount[]>('/api/stock-counts') });
}

export function useStockCount(id: number | null) {
  return useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => api<StockCount & { expected: CountItem[]; extra: CountItem[] }>(`/api/stock-counts/${id}`),
    enabled: !!id,
  });
}

export function useStockCountReport(id: number) {
  return useQuery({
    queryKey: ['stock-count-report', id],
    queryFn: () =>
      api<any>(`/api/stock-counts/${id}/report`),
  });
}

export function useInvoices(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({ queryKey: ['invoices', qs], queryFn: () => api<Invoice[]>(`/api/invoices${qs}`) });
}

export function useInvoice(id: number | null) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api<Invoice>(`/api/invoices/${id}`),
    enabled: !!id,
  });
}

export function useReservations(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({ queryKey: ['reservations', qs], queryFn: () => api<Reservation[]>(`/api/reservations${qs}`) });
}

export function useShifts() {
  return useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/api/shifts') });
}

export function useCurrentShift() {
  return useQuery({ queryKey: ['shift-current'], queryFn: () => api<Shift | null>('/api/shifts/current') });
}

export function usePaymentMethods() {
  return useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethod[]>('/api/payment-methods') });
}

export function usePaymentMethodsActive() {
  return useQuery({
    queryKey: ['payment-methods-active'],
    queryFn: () => api<PaymentMethod[]>('/api/payment-methods'),
    select: (all) => all.filter((m) => m.isActive),
  });
}

export function useStockLimitsReport() {
  return useQuery({ queryKey: ['report-stock-limits'], queryFn: () => api<StockLimit[]>('/api/reports/stock-limits') });
}

export function useInvCache() {
  const qc = useQueryClient();
  return {
    invalidate: (...keys: string[][]) => {
      for (const k of keys) qc.invalidateQueries({ queryKey: k });
    },
    qc,
  };
}

export function useMutationWithToast(
  fn: (...args: any[]) => Promise<any>,
  opts?: { onSuccess?: (data: any) => void; onError?: (e: any) => void },
) {
  const { onSuccess, onError } = opts ?? {};
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => onSuccess?.(data),
    onError: (e: any) => onError?.(e),
  });
}
