'use client';
/**
 * Turn on two-step verification (authenticator app, TOTP).
 *   1. confirm password  -> Better Auth returns an otpauth:// URI + backup codes
 *   2. scan the QR code (or type the key) and enter the 6-digit code
 *   3. save the backup codes (each works once if the phone is lost)
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { authClient, authErrorMessage } from '@/lib/authClient';
import { AuthField, FormError } from './AuthCard';

type Step = 'password' | 'scan' | 'codes';

export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState('');
  const [qr, setQr] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (uri) QRCode.toDataURL(uri, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''));
  }, [uri]);

  const secret = uri ? new URL(uri).searchParams.get('secret') ?? '' : '';

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (err || !data || !('totpURI' in data)) return setError(authErrorMessage(err, 'Could not start set-up.'));
    setUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword('');
    setStep('scan');
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
    setBusy(false);
    if (err) return setError('That code is not right. Check the time on your phone and try the newest code.');
    setStep('codes');
  }

  if (step === 'password') {
    return (
      <form onSubmit={start} className="space-y-4">
        <p className="text-sm text-fg-muted">
          You will need an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
        </p>
        <AuthField id="tfa-password" label="Your password" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    );
  }

  if (step === 'scan') {
    return (
      <form onSubmit={confirm} className="space-y-4">
        <p className="text-sm text-fg">Scan this code with your authenticator app. It will be listed there as “ShiftGO”.</p>
        {qr && (
          <img src={qr} alt="QR code to add your account to your authenticator app" width={220} height={220} className="mx-auto rounded-md border border-border" />
        )}
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Can&apos;t scan it? Type this key instead</summary>
          <p className="mt-2 break-all rounded-md bg-surface-subtle p-2 font-mono text-xs text-fg">{secret}</p>
        </details>
        <AuthField id="tfa-code" label="6-digit code from the app" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy ? 'Checking…' : 'Turn on two-step verification'}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg">
        Two-step verification is on. Save these backup codes somewhere safe — each one signs you in once if you lose your phone.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface-subtle p-3 font-mono text-sm text-fg" aria-label="Backup codes">
        {backupCodes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}>Copy codes</Button>
        <Button variant="primary" className="flex-1" onClick={onDone}>I&apos;ve saved them</Button>
      </div>
    </div>
  );
}
