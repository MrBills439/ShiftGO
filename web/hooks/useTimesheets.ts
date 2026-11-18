import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, authedDownload } from '@/lib/api';
import { AttendanceReviewItem, Timesheet } from '@/types';

export function useMyTimesheets() {
  return useQuery<Timesheet[]>({
    queryKey: ['timesheets', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/timesheets/me');
      return data.data;
    },
    staleTime: 20_000,
  });
}

export function useHouseTimesheets(houseId: string) {
  return useQuery<Timesheet[]>({
    queryKey: ['timesheets', houseId],
    queryFn: async () => {
      const { data } = await api.get(`/timesheets/house/${houseId}`);
      return data.data;
    },
    enabled: !!houseId,
    staleTime: 20_000,
  });
}

export function useConfirmTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/timesheets/${id}/confirm`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRejectTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/timesheets/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Attendance records the GPS state machine flagged (needsReview=true) —
 *  agency-wide, MANAGER/HR only. */
export function useNeedsReview() {
  return useQuery<AttendanceReviewItem[]>({
    queryKey: ['timesheets', 'needs-review'],
    queryFn: async () => {
      const { data } = await api.get('/timesheets/needs-review');
      return data.data;
    },
    staleTime: 15_000,
  });
}

/** Resolve a flagged attendance record: confirm an open one's clock-out time,
 *  or clear review on an already-closed one (omit clockOutTime). */
export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clockOutTime, reason }: { id: string; clockOutTime?: string; reason?: string }) =>
      api.post(`/timesheets/${id}/resolve-review`, { clockOutTime, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function exportTimesheetPDF(houseId: string) {
  return authedDownload(`/timesheets/house/${houseId}/export`, `timesheet-${houseId}.pdf`);
}
