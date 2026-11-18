'use client';
import { useEffect, useState } from 'react';
import { ShieldCheckIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { NoticeText } from '@/components/privacy/NoticeText';
import { useToast } from '@/hooks/useToast';
import {
  usePrivacyNotice, useUpdateNotice, useDeletionRequests, useResolveDeletion, type DeletionRequest,
} from '@/hooks/useDataRights';

/** HR: publish the agency's staff privacy notice. */
export function PrivacyNoticeEditor() {
  const toast = useToast();
  const { data: notice } = usePrivacyNotice();
  const update = useUpdateNotice();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => { if (notice) setText(notice.text); }, [notice?.version]);

  async function publish(next: string) {
    try {
      await update.mutateAsync(next);
      toast.success(next ? 'Notice published. Staff will be asked to read it again.' : 'Back to the ShiftGO template.');
    } catch {
      toast.error('Could not save the notice.');
    }
  }

  return (
    <div className="glass-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e6f4f0]">
          <ShieldCheckIcon size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-on-surface">Staff privacy notice</h2>
          <p className="text-xs text-on-surface-variant">
            {notice?.isDefault ? 'Using the ShiftGO template' : 'Using your own notice'} · every staff member must read the current version
          </p>
        </div>
      </div>
      {notice?.isDefault && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/50 p-3 text-xs text-fg">
          <WarningIcon size={16} className="mt-0.5 flex-shrink-0" />
          <p>The template is a starting draft, not legal advice. Have your data protection lead check it, add your contact details, then publish your own version.</p>
        </div>
      )}
      <label htmlFor="privacy-notice-text" className="sr-only">Privacy notice text</label>
      <Textarea id="privacy-notice-text" rows={16} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
      <p className="mt-2 text-xs text-on-surface-variant">Use “# ” and “## ” for headings and “- ” for bullet points.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => publish(text)} disabled={update.isPending || !text.trim()}>Publish</Button>
        <Button onClick={() => setPreview(true)}>Preview</Button>
        {!notice?.isDefault && <Button variant="ghost" onClick={() => publish('')} disabled={update.isPending}>Use the template</Button>}
      </div>
      <Modal open={preview} onClose={() => setPreview(false)} title="Preview" width="max-w-2xl">
        <NoticeText text={text} />
      </Modal>
    </div>
  );
}

/** HR: account deletion requests. */
export function DeletionRequestsPanel() {
  const toast = useToast();
  const { data: requests = [], isLoading } = useDeletionRequests('PENDING');
  const resolve = useResolveDeletion();
  const [active, setActive] = useState<{ req: DeletionRequest; action: 'complete' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  async function submit() {
    if (!active) return;
    try {
      await resolve.mutateAsync({ id: active.req.id, action: active.action, note: note.trim() || undefined });
      toast.success(active.action === 'complete' ? 'Deletion completed.' : 'Request declined. The employee has been told.');
      setActive(null);
      setNote('');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not update the request.');
    }
  }

  return (
    <div className="glass-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#fdecea]">
          <TrashIcon size={18} className="text-[#b3261e]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-on-surface">Account deletion requests</h2>
          <p className="text-xs text-on-surface-variant">Respond within one month (UK GDPR)</p>
        </div>
      </div>
      {isLoading ? null : requests.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No open requests.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface">{r.user.name}</p>
                <p className="text-xs text-on-surface-variant">
                  Asked {new Date(r.createdAt).toLocaleDateString('en-GB')} · {r.user.status === 'DEACTIVATED' ? 'Deactivated' : 'Still active'}
                  {r.reason ? ` · “${r.reason}”` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setActive({ req: r, action: 'reject' })}>Decline</Button>
                <Button size="sm" variant="danger" onClick={() => setActive({ req: r, action: 'complete' })}>Complete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.action === 'complete' ? `Complete deletion for ${active?.req.user.name}` : `Decline request from ${active?.req.user.name}`}
      >
        <div className="space-y-4">
          {active?.action === 'complete' ? (
            <p className="text-sm leading-relaxed text-on-surface">
              {active.req.user.status !== 'DEACTIVATED' && <strong className="block pb-2">Deactivate this employee first (Staff → their page → Deactivate).</strong>}
              This permanently deletes their contact details, photo, notifications, GPS points and DBS record.
              Name, email, shifts, timesheets, leave and training are kept, as the law requires.
            </p>
          ) : (
            <p className="text-sm text-on-surface">Tell them why. Your reply is sent to them.</p>
          )}
          <div>
            <label htmlFor="deletion-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {active?.action === 'reject' ? 'Reason' : 'Note (optional)'}
            </label>
            <Textarea id="deletion-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              className="flex-1"
              variant={active?.action === 'complete' ? 'danger' : 'primary'}
              onClick={submit}
              disabled={resolve.isPending || (active?.action === 'reject' && !note.trim())}
            >
              {active?.action === 'complete' ? 'Delete data' : 'Send reply'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
