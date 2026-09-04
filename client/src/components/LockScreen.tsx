import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut, Gem, Loader2 } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface LockScreenProps {
  onUnlock: () => void;
}

// Full-screen lock overlay shown after inactivity; requires the logged-in
// user's PIN to resume. Logging out clears the session.
export default function LockScreen({ onUnlock }: LockScreenProps) {
  const { employee, logout } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pin || loading) return;
    setLoading(true);
    setError(false);
    try {
      await api('/api/auth/verify-pin', { method: 'POST', body: { pin } });
      setPin('');
      onUnlock();
    } catch {
      setError(true);
      setPin('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const doLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/25">
          <Gem className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-lg font-extrabold text-slate-900">الشاشة مقفلة</h1>
        <p className="mt-1 text-sm text-slate-500">
          {employee?.fullName} — أدخل رمز PIN الخاص بك للمتابعة
        </p>

        <input
          ref={inputRef}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''));
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="••••"
          maxLength={8}
          dir="ltr"
          className={cn(
            'mt-6 w-40 rounded-xl border-2 px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none transition-colors',
            error
              ? 'border-rose-400 bg-rose-50 text-rose-700'
              : 'border-slate-300 text-slate-900 focus:border-brand-500',
          )}
        />

        {error && <div className="mt-2 text-sm font-medium text-rose-600">رمز PIN غير صحيح</div>}

        <button
          type="submit"
          disabled={!pin || loading}
          className={cn(
            'mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-white transition-colors',
            pin ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-slate-300',
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          إلغاء القفل
        </button>

        <button
          type="button"
          onClick={doLogout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-rose-600"
        >
          <LogOut className="h-4 w-4" />
          تسجيل الخروج
        </button>
      </form>
    </div>,
    document.body,
  );
}
