import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gem, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { usePublicSettings } from '@/hooks/useData';
import { storeName } from '@/lib/branding';

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const { data: settings } = usePublicSettings();
  const name = storeName(settings);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(identifier, pin);
      navigate('/');
    } catch {
      setError('بيانات الدخول غير صحيحة، تأكد من اسم المستخدم وكود الدخول');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-[#e9e2d2] p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/25">
              <Gem className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-900">نظام {name}</h1>
            <p className="text-sm text-slate-500">إدارة المخزون، التسعير اليومي، والمبيعات</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>اسم المستخدم أو رقم الموظف</Label>
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="مثال: manager"
                autoFocus
                dir="ltr"
                className="text-center"
              />
            </div>
            <div>
              <Label>كود الدخول (PIN)</Label>
              <div className="relative">
                <Input
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="text-center tracking-[0.5em]"
                  dir="ltr"
                  maxLength={10}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <Button type="submit" variant="brand" className="w-full" loading={loading} size="lg">
              تسجيل الدخول
            </Button>
          </form>

          <div className="mt-6 rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-500">
            حسابات تجريبية (كود: 1234) — مدير: manager · كاشير: cashier · سوشيال: social
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
