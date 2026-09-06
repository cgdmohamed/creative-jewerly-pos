import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/stores/auth';
import AppShell from '@/components/layout/AppShell';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Pos from '@/pages/Pos';
import Items from '@/pages/Items';
import Pricing from '@/pages/Pricing';
import Locations from '@/pages/Locations';
import Transfers from '@/pages/Transfers';
import StockCounts from '@/pages/StockCounts';
import Invoices from '@/pages/Invoices';
import Reservations from '@/pages/Reservations';
import Shifts from '@/pages/Shifts';
import Reports from '@/pages/Reports';
import Employees from '@/pages/Employees';
import PaymentMethods from '@/pages/PaymentMethods';
import Settings from '@/pages/Settings';
import Customers from '@/pages/Customers';
import WooCommerce from '@/pages/WooCommerce';
import Wholesale from '@/pages/Wholesale';
import { usePublicSettings } from '@/hooks/useData';
import { storeName } from '@/lib/branding';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function BrandTitle() {
  const { data: settings } = usePublicSettings();
  useEffect(() => {
    document.title = `نظام ${storeName(settings)}`;
  }, [settings]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandTitle />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos" element={<Pos />} />
            <Route path="/items" element={<Items />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/stock-counts" element={<StockCounts />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/shifts" element={<Shifts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/payment-methods" element={<PaymentMethods />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/woocommerce" element={<WooCommerce />} />
            <Route path="/wholesale" element={<Wholesale />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
