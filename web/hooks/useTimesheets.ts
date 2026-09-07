import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
  const token = typeof window !== 'undefined' ? localStorage.getItem('shiftgo_access') : '';
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const url = `${base}/timesheets/house/${houseId}/export`;
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('target', '_blank');
  const req = new XMLHttpRequest();
  req.open('GET', url, true);
  req.setRequestHeader('Authorization', `Bearer ${token}`);
  req.responseType = 'blob';
  req.onload = () => {
    const blob = new Blob([req.response], { type: 'application/pdf' });
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = `timesheet-${houseId}.pdf`;
    a.click();
    URL.revokeObjectURL(objUrl);
  };
  req.send();
}
