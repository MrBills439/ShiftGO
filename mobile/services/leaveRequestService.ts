import { api } from './api';
import { LeaveBalanceSummary, LeaveRequest } from '../types';

export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await api.get('/leave-requests');
  return data.data;
}

export async function getLeaveBalance(): Promise<LeaveBalanceSummary> {
  const { data } = await api.get('/leave-requests/balance');
  return data.data;
}

export async function createLeaveRequest(payload: {
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<LeaveRequest> {
  const { data } = await api.post('/leave-requests', payload);
  return data.data;
}

export async function cancelLeaveRequest(id: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leave-requests/${id}/cancel`);
  return data.data;
}
