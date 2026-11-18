'use client';
/**
 * Shows the agency's privacy notice, full screen, until the signed-in person
 * has acknowledged the current version. If the notice cannot be loaded the app
 * is NOT blocked (an outage must never lock staff out of rotas); the gate
 * simply appears on a later load.
 */
import { useState } from 'react';
import { ShieldCheckIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { NoticeText } from './NoticeText';
import { usePrivacyNotice, useAcknowledgeNotice } from '@/hooks/useDataRights';
import { useAuthStore } from '@/store/authStore';

export function PrivacyNoticeGate({ children }: { children: React.ReactNode }) {
  const { data: notice, isLoading } = usePrivacyNotice();
  const acknowledge = useAcknowledgeNotice();
  const logout = useAuthStore((s) => s.logout);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !notice || notice.acknowledged) return <>{children}</>;

  async function accept() {
    setError(null);
    try {
      await acknowledge.mutateAsync(notice!.version);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 409
        ? 'The notice was just updated. Please read the latest version below.'
        : 'Could not save that. Check your connection and try again.');
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-surface-subtle px-4 py-10">
      <main
        className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-sm"
        aria-labelledby="privacy-notice-heading"
      >
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50">
            <ShieldCheckIcon size={18} className="text-brand-700" />
          </div>
          <div>
            <h1 id="privacy-notice-heading" className="text-base font-semibold text-fg">Before you continue</h1>
            <p className="text-xs text-fg-muted">Please read how your information is used.</p>
          </div>
        </div>
        {/* Focusable so keyboard users can scroll the notice (WCAG 2.1.1). */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5" tabIndex={0} role="region" aria-label="Privacy notice text">
          <NoticeText text={notice.text} />
        </div>
        <div className="space-y-3 border-t border-border px-6 py-4">
          {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={logout}>Sign out</Button>
            <Button variant="primary" onClick={accept} disabled={acknowledge.isPending}>
              {acknowledge.isPending ? 'Saving…' : 'I have read this notice'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
