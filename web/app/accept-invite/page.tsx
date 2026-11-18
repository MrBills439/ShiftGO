'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { AuthCard, AuthField, FormError } from '@/components/auth/AuthCard';
import { api } from '@/lib/api';
import { authClient } from '@/lib/authClient';

type Preview = { email: string; name: string | null; agencyName: string; role: string };

function messageFrom(err: unknown, fallback: string) {
  const e = err as { response?: { status?: number; data?: { message?: string } } };
  if (e.response?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return e.response?.data?.message || fallback;
}

function AcceptInvite() {
  const params = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Keep the token out of the address bar and browser history once read.
    if (token) window.history.replaceState(null, '', '/accept-invite');
    if (!token) { setLoadError('This link is missing its invitation code. Open the link from your email again.'); return; }
    api.get(`/invitations/${encodeURIComponent(token)}`)
      .then((r) => { setPreview(r.data.data); setName(r.data.data.name ?? ''); })
      .catch((err) => setLoadError(messageFrom(err, 'We could not check this invitation. Try again in a moment.')));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords are different.');
    setBusy(true); setError(null);
    try {
      const { data } = await api.post('/invitations/accept', { token, password, name: name.trim() || undefined });
      const { error: signInError } = await authClient.signIn.email({ email: data.data.email, password });
      // HR/managers are taken to the two-step set-up screen by the dashboard.
      window.location.href = signInError ? '/sign-in' : '/dashboard';
    } catch (err) {
      setBusy(false);
      setError(messageFrom(err, 'We could not create your account. Try again.'));
    }
  }

  if (loadError) {
    return (
      <AuthCard title="Invitation not available">
        <p role="alert" className="text-sm text-fg">{loadError}</p>
        <p className="mt-4 text-sm"><Link href="/sign-in" className="font-medium text-brand-700 underline">Go to sign in</Link></p>
      </AuthCard>
    );
  }

  if (!preview) {
    return <AuthCard title="Checking your invitation…"><p role="status" className="text-sm text-fg-muted">One moment.</p></AuthCard>;
  }

  return (
    <AuthCard title={`Join ${preview.agencyName}`} subtitle={`Set a password for ${preview.email}.`}>
      <form onSubmit={submit} className="space-y-4">
        {!preview.name && (
          <AuthField id="name" label="Your full name" autoComplete="name" required
            value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <AuthField id="new-password" label="Password" type="password" autoComplete="new-password" required
          minLength={10} maxLength={128} hint="At least 10 characters. A short phrase is easier to remember." value={password} onChange={(e) => setPassword(e.target.value)} />
        <AuthField id="confirm-password" label="Type it again" type="password" autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || password.length < 10}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitePage() {
  return <Suspense><AcceptInvite /></Suspense>;
}
