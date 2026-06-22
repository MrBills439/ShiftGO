import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Timesheet } from '@/types';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets'] }),
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
