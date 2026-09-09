import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ShiftChangeType = 'COVER' | 'SWAP';
export type ShiftChangeStatus =
  | 'PENDING_RECIPIENT' | 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export interface ShiftChangeShift {
  id: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  status: string;
  house: { id: string; name: string } | null;
}

export interface ShiftChangeProjection {
  scheduledHours: number;
  projectedHours: number;
  maxWeeklyScheduledHours: number;
  hoursStatus: string;
  exceedsMax: boolean;
}

export interface ShiftChangeRequest {
  id: string;
  type: ShiftChangeType;
  status: ShiftChangeStatus;
  expired: boolean;
  requesterReason: string | null;
  managerReason: string | null;
  recipientResponse: 'ACCEPTED' | 'DECLINED' | null;
  createdAt: string;
  requester: { id: string; name: string } | null;
  targetWorker: { id: string; name: string } | null;
  primaryShift: ShiftChangeShift | null;
  swapShift: ShiftChangeShift | null;
  projectedHours?: Record<string, ShiftChangeProjection>;
}

interface PendingResponse {
  page: number;
  pageSize: number;
  total: number;
  items: ShiftChangeRequest[];
}

/** Manager/HR — requests awaiting approval (or filter to APPROVED / REJECTED). */
export function usePendingShiftChanges(
  status: 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED' = 'PENDING_MANAGER',
  enabled = true,
) {
  return useQuery<PendingResponse>({
    queryKey: ['shift-change', 'pending', status],
    queryFn: async () => {
      const { data } = await api.get('/shift-change/pending-approval', { params: { status } });
      return data.data;
    },
    staleTime: 15_000,
    enabled,
  });
}

/** Worker — my sent + incoming requests. */
export function useMyShiftChanges() {
  return useQuery<{
    sent: { total: number; items: ShiftChangeRequest[] };
    incoming: { total: number; items: ShiftChangeRequest[] };
  }>({
    queryKey: ['shift-change', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/shift-change/me');
      return data.data;
    },
    staleTime: 15_000,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['shift-change'] });
  qc.invalidateQueries({ queryKey: ['shifts'] });
  qc.invalidateQueries({ queryKey: ['rota'] });
  qc.invalidateQueries({ queryKey: ['staff-allocation'] });
}

export function useApproveShiftChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrideWeeklyHours, overrideReason }: { id: string; overrideWeeklyHours?: boolean; overrideReason?: string }) =>
      api.post(`/shift-change/${id}/approve`, { overrideWeeklyHours, overrideReason }),
    onSuccess: () => invalidate(qc),
  });
}

export function useRejectShiftChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/shift-change/${id}/reject`, { reason }),
    onSuccess: () => invalidate(qc),
  });
}
