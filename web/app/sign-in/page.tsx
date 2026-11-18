'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { AuthCard, AuthField, FormError } from '@/components/auth/AuthCard';
import { authClient, authErrorMessage } from '@/lib/authClient';
import { safeNext } from '@/lib/safeNext';

function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = params.get('reset') === '1' ? 'Your password has been changed. Sign in with the new one.' : null;

  // Full page load so AuthSync starts fresh with the new session cookie.
  const finish = () => { window.location.href = next; };

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, 'Could not sign in.'));
    setPassword('');
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return setStep('code');
    finish();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const clean = code.replace(/\s/g, '');
    const { error: err } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: clean, trustDevice });
    setBusy(false);
    if (err) {
      return setError(err.status === 429 ? authErrorMessage(err, '') : 'That code is not right. Try the newest code from your app.');
    }
    finish();
  }

  if (step === 'code') {
    return (
      <AuthCard title="Enter your code" subtitle={useBackup ? 'Type one of the backup codes you saved.' : 'Open your authenticator app and type the 6-digit code for ShiftGO.'}>
        <form onSubmit={submitCode} className="space-y-4">
          <AuthField
            id="code" label={useBackup ? 'Backup code' : '6-digit code'} required
            inputMode={useBackup ? 'text' : 'numeric'} autoComplete="one-time-code"
            value={code} onChange={(e) => setCode(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Don&apos;t ask again on this computer for 30 days
          </label>
          <FormError message={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <button type="button" className="w-full text-sm font-medium text-brand-700 underline"
            onClick={() => { setUseBackup(!useBackup); setCode(''); setError(null); }}>
            {useBackup ? 'Use my authenticator app instead' : 'Lost your phone? Use a backup code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in to ShiftGO">
      <form onSubmit={submitPassword} className="space-y-4">
        {notice && <p role="status" className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm text-fg">{notice}</p>}
        <AuthField id="email" label="Email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <AuthField id="password" label="Password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-sm">
          <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="font-medium text-brand-700 underline">
            Forgot your password?
          </Link>
        </p>
        <p className="text-center text-xs text-fg-subtle">
          New to ShiftGO? Use the invitation link your employer emailed you.
        </p>
      </form>
    </AuthCard>
  );
}

export default function SignInPage() {
  return <Suspense><SignInForm /></Suspense>;
}
