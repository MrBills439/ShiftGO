import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { LeaveBalanceSummary, LeaveRequest, LeaveStatus } from '@/types';

export type LeaveRequestFilters = {
  status?: LeaveStatus | '';
  workerId?: string;
};

export type CreateLeaveRequestInput = {
  workerId?: string;
  startDate: string;
  endDate: string;
  reason?: string;
};

export function useLeaveRequests(filters: LeaveRequestFilters = {}) {
  return useQuery<LeaveRequest[]>({
    queryKey: ['leave-requests', filters],
    queryFn: async () => {
      const params = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.workerId ? { workerId: filters.workerId } : {}),
      };
      const { data } = await api.get('/leave-requests', { params });
      return data.data;
    },
    staleTime: 30_000,
  });
}

/**
 * PTO balance breakdown. Omit `workerId` for the current user's own balance;
 * managers/HR may pass a workerId to inspect a team member's.
 */
export function useLeaveBalance(workerId?: string) {
  return useQuery<LeaveBalanceSummary>({
    queryKey: ['leave-balance', workerId ?? 'me'],
    queryFn: async () => {
      const { data } = await api.get('/leave-requests/balance', {
        params: workerId ? { workerId } : undefined,
      });
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeaveRequestInput) => api.post('/leave-requests', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-balance'] });
    },
  });
}

export function useApproveLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });
}

export function useRejectLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rejectionReason }: { id: string; rejectionReason: string }) =>
      api.post(`/leave-requests/${id}/reject`, { rejectionReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-balance'] });
    },
  });
}

export function useCancelLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });
}
