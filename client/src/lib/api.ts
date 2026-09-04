import type { Employee } from './types';

const TOKEN_KEY = 'jewelry_token';
const EMP_KEY = 'jewelry_employee';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, employee: Employee) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMP_KEY, JSON.stringify(employee));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMP_KEY);
}

export function getCachedEmployee(): Employee | null {
  const raw = localStorage.getItem(EMP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: any } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    ...options,
    headers,
    body:
      options.body instanceof FormData || typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });

  if (res.status === 401) {
    clearSession();
    window.location.hash = '#/login';
    throw new ApiError(401, 'auth.required');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data as any)?.message || (data as any)?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export function hasPermission(emp: Employee | null, code: string): boolean {
  if (!emp) return false;
  return emp.permissions.includes(code);
}
