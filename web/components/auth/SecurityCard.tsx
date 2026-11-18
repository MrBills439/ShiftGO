'use client';
/** Profile page: change password, and turn two-step verification on (or off, for workers). */
import { useState } from 'react';
import { KeyIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/store/authStore';
import { authClient, authErrorMessage } from '@/lib/authClient';
import { AuthField, FormError } from './AuthCard';
import { TwoFactorSetup } from './TwoFactorSetup';

export function SecurityCard() {
  const toast = useToast();
  const { user, retrySync } = useAuthStore();
  const [pwOpen, setPwOpen] = useState(false);
  const [tfaOpen, setTfaOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mustKeep2fa = user?.role === 'HR' || user?.role === 'MANAGER';

  const reset = () => { setCurrent(''); setNext(''); setError(null); setBusy(false); };

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (err) return setError(err.status === 400 && /invalid/i.test(err.message ?? '') ? 'Your current password is not right.' : authErrorMessage(err, 'Could not change your password.'));
    setPwOpen(false); reset();
    toast.success('Password changed. You have been signed out on your other devices.');
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.disable({ password: current });
    setBusy(false);
    if (err) return setError(authErrorMessage(err, 'Could not turn it off.'));
    setOffOpen(false); reset(); retrySync();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <KeyIcon size={18} className="text-brand-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-fg">Sign-in and security</h2>
      </div>
      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">Password</dt>
          <dd><Button size="sm" onClick={() => { reset(); setPwOpen(true); }}>Change password</Button></dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">Two-step verification: <span className="font-medium text-fg">{user?.twoFactorEnabled ? 'On' : 'Off'}</span></dt>
          <dd>
            {!user?.twoFactorEnabled && <Button size="sm" onClick={() => setTfaOpen(true)}>Turn on</Button>}
            {user?.twoFactorEnabled && !mustKeep2fa && <Button size="sm" onClick={() => { reset(); setOffOpen(true); }}>Turn off</Button>}
          </dd>
        </div>
      </dl>
      {user?.twoFactorEnabled && mustKeep2fa && (
        <p className="mt-3 text-xs text-fg-subtle">Two-step verification is required for HR and manager accounts.</p>
      )}

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <form onSubmit={changePassword} className="space-y-4">
          <AuthField id="current-password" label="Current password" type="password" autoComplete="current-password" required
            value={current} onChange={(e) => setCurrent(e.target.value)} />
          <AuthField id="new-password" label="New password" type="password" autoComplete="new-password" required
            minLength={10} maxLength={128} hint="At least 10 characters." value={next} onChange={(e) => setNext(e.target.value)} />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !current || next.length < 10}>{busy ? 'Saving…' : 'Change password'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={tfaOpen} onClose={() => setTfaOpen(false)} title="Turn on two-step verification">
        <TwoFactorSetup onDone={() => { setTfaOpen(false); retrySync(); }} />
      </Modal>

      <Modal open={offOpen} onClose={() => setOffOpen(false)} title="Turn off two-step verification">
        <form onSubmit={turnOff} className="space-y-4">
          <AuthField id="tfa-off-password" label="Your password" type="password" autoComplete="current-password" required
            value={current} onChange={(e) => setCurrent(e.target.value)} />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOffOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={busy || !current}>Turn off</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
