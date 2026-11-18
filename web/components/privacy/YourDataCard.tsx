'use client';
import { useState } from 'react';
import { DownloadSimpleIcon, LockKeyIcon, TrashIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { NoticeText } from './NoticeText';
import { useToast } from '@/hooks/useToast';
import {
  downloadMyData, useMyDeletionRequest, useRequestDeletion, useCancelDeletion, usePrivacyNotice,
} from '@/hooks/useDataRights';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Profile page: privacy notice, "Download my data", "Request account deletion". */
export function YourDataCard() {
  const toast = useToast();
  const { data: notice } = usePrivacyNotice();
  const { data: deletion } = useMyDeletionRequest();
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();
  const [downloading, setDownloading] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');

  async function download() {
    setDownloading(true);
    try {
      await downloadMyData();
    } catch {
      toast.error('Could not download your data. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function submitDeletion() {
    try {
      await requestDeletion.mutateAsync(reason);
      setDeleteOpen(false);
      setReason('');
      toast.success('Request sent to HR. They will contact you.');
    } catch {
      toast.error('Could not send the request. Please try again.');
    }
  }

  const pending = deletion?.status === 'PENDING';

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
          <LockKeyIcon size={18} className="text-brand-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-fg">Your data</h2>
          <p className="text-xs text-fg-muted">See, download or ask us to delete your information</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <p className="text-xs text-fg-muted">
            {notice?.acknowledgedAt ? `Privacy notice read on ${fmt(notice.acknowledgedAt)}` : 'Privacy notice'}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setNoticeOpen(true)}>Read notice</Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <p className="text-xs text-fg-muted">A copy of everything we hold about you (JSON file)</p>
          <Button size="sm" icon={<DownloadSimpleIcon size={14} />} onClick={download} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download my data'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-fg-muted">
            {pending && `Deletion requested on ${fmt(deletion!.createdAt)}. HR will contact you.`}
            {deletion?.status === 'REJECTED' && `HR replied: ${deletion.resolutionNote}`}
            {deletion?.status === 'COMPLETED' && 'Your deletion request was completed.'}
            {(!deletion || deletion.status === 'CANCELLED') && 'Ask HR to delete your account and the data they no longer need'}
          </p>
          {pending ? (
            <Button size="sm" variant="ghost" onClick={() => cancelDeletion.mutate()} disabled={cancelDeletion.isPending}>
              Cancel request
            </Button>
          ) : deletion?.status !== 'COMPLETED' && (
            <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} onClick={() => setDeleteOpen(true)}>
              Request account deletion
            </Button>
          )}
        </div>
      </div>

      <Modal open={noticeOpen} onClose={() => setNoticeOpen(false)} title="Privacy notice" width="max-w-2xl">
        {notice && <NoticeText text={notice.text} />}
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Request account deletion">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-fg">
            HR will close your account and delete your contact details, photo, notifications, location points and DBS record.
            By law they must keep some records, such as timesheets for payroll and right-to-work checks, for a set time.
          </p>
          <div>
            <label htmlFor="deletion-reason" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Reason (optional)
            </label>
            <Textarea id="deletion-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setDeleteOpen(false)}>Keep my account</Button>
            <Button className="flex-1" variant="danger" onClick={submitDeletion} disabled={requestDeletion.isPending}>
              {requestDeletion.isPending ? 'Sending…' : 'Send request to HR'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
