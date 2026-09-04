import { create } from 'zustand';
import type { Employee } from '@/lib/types';
import { api, getCachedEmployee, getToken, setSession, clearSession } from '@/lib/api';
import { setScreenLocked } from '@/lib/lock';

interface AuthState {
  employee: Employee | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, pin: string) => Promise<void>;
  logout: () => void;
  restore: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  employee: getCachedEmployee(),
  token: getToken(),
  loading: false,
  restore: () => set({ employee: getCachedEmployee(), token: getToken() }),
  login: async (identifier, pin) => {
    set({ loading: true });
    try {
      const res = await api<{ token: string; employee: Employee }>('/api/auth/login', {
        method: 'POST',
        body: { identifier, pin },
      });
      setSession(res.token, res.employee);
      set({ employee: res.employee, token: res.token });
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    setScreenLocked(false);
    clearSession();
    set({ employee: null, token: null });
  },
}));

export function can(perm: string): boolean {
  const emp = useAuth.getState().employee;
  if (!emp) return false;
  return emp.permissions.includes(perm);
}
