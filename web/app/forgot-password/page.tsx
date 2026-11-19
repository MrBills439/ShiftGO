'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { AuthCard, AuthField, FormError } from '@/components/auth/AuthCard';
import { authClient, authErrorMessage } from '@/lib/authClient';

function ForgotPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'forget-password' });
    setBusy(false);
    // Same screen whether or not the account exists, so this can't be used to check emails.
    if (err && err.status === 429) return setError(authErrorMessage(err, ''));
    setStep('reset');
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords are different.');
    setBusy(true); setError(null);
    const { error: err } = await authClient.emailOtp.resetPassword({ email: email.trim(), otp: otp.replace(/\s/g, ''), password });
    setBusy(false);
    if (err) {
      if (err.status === 429) return setError(authErrorMessage(err, ''));
      if (/password/i.test(err.message ?? '') && /short|long/i.test(err.message ?? '')) return setError('Use between 10 and 128 characters.');
      return setError('That code is wrong or has expired. Ask for a new one.');
    }
    router.replace('/sign-in?reset=1');
  }

  if (step === 'email') {
    return (
      <AuthCard title="Reset your password" subtitle="We'll email you a 6-digit code.">
        <form onSubmit={sendCode} className="space-y-4">
          <AuthField id="email" label="Email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <FormError message={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send code'}
          </Button>
          <p className="text-center text-sm"><Link href="/sign-in" className="font-medium text-brand-700 underline">Back to sign in</Link></p>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Check your email" subtitle={`If ${email} has a LeafRota account, we've sent it a code. It works for 10 minutes.`}>
      <form onSubmit={reset} className="space-y-4">
        <AuthField id="otp" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" required
          maxLength={7} value={otp} onChange={(e) => setOtp(e.target.value)} />
        <AuthField id="new-password" label="New password" type="password" autoComplete="new-password" required
          minLength={10} maxLength={128} hint="At least 10 characters." value={password} onChange={(e) => setPassword(e.target.value)} />
        <AuthField id="confirm-password" label="Type it again" type="password" autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !otp || !password}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
        <p className="text-center text-sm">
          <button type="button" className="font-medium text-brand-700 underline" disabled={busy} onClick={() => sendCode()}>
            Send a new code
          </button>
        </p>
      </form>
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return <Suspense><ForgotPasswordForm /></Suspense>;
}
