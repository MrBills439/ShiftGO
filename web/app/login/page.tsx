'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, hydrate, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => { hydrate(); }, []);
  useEffect(() => { if (user) router.replace('/dashboard'); }, [user]);

  async function submitLogin() {
    if (!email || !password) { setError('Enter your email and password'); return; }
    setLoading(true); setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitLogin();
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#003d35] via-[#005f55] to-[#0d7a6e] flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/30 flex items-center justify-center">
            <span className="text-white text-lg font-bold">S</span>
          </div>
          <span className="text-white text-xl font-bold tracking-wide">ShiftGO</span>
        </div>
        <div>
          <h2 className="text-4xl font-bold text-white leading-snug mb-4">
            GPS-powered shift attendance for care support teams
          </h2>
          <p className="text-white/65 text-base leading-relaxed">
            Auto clock-in when workers arrive at a care house. Real-time visibility for managers.
            Confirmed timesheets downloaded as PDF.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[['Auto GPS', 'Clock-in on arrival'], ['4 Roles', 'Hierarchy access'], ['PDF', 'Timesheet export']].map(([t, s]) => (
              <div key={t} className="bg-white/10 border border-white/20 rounded-xl p-4">
                <p className="text-white text-sm font-semibold">{t}</p>
                <p className="text-white/60 text-xs mt-1">{s}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-white/30 text-xs">ShiftGO v1.0 · Care Management Platform</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-surface">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-primary-DEFAULT flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="text-on-surface font-bold text-lg">ShiftGO</span>
          </div>

          <h1 className="text-2xl font-bold text-on-surface mb-1">Welcome back</h1>
          <p className="text-sm text-on-surface-variant mb-8">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="input-field"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
                >
                  {showPw ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-error-container border border-error-DEFAULT/20 rounded-md px-3 py-2.5">
                <p className="text-sm text-error-DEFAULT">{error}</p>
              </div>
            )}

            <button type="button" onClick={() => void submitLogin()} disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-on-surface-variant font-inter text-center mt-8">
            Access is managed by your HR administrator
          </p>
        </div>
      </div>
    </div>
  );
}
