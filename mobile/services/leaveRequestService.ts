import { api } from './api';
import { LeaveRequest } from '../types';

export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await api.get('/leave-requests');
  return data.data;
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest> {
  const { data } = await api.get(`/leave-requests/${id}`);
  return data.data;
}

export async function createLeaveRequest(payload: {
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<LeaveRequest> {
  const { data } = await api.post('/leave-requests', payload);
  return data.data;
}

export async function cancelLeaveRequest(id: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leave-requests/${id}/cancel`);
  return data.data;
}

export async function getPendingLeaveRequests(): Promise<LeaveRequest[]> {
  try {
    const requests = await getLeaveRequests();
    return requests.filter((r) => r.status === 'PENDING');
  } catch (error) {
    console.error('Error getting pending leave requests:', error);
    return [];
  }
}

export async function getApprovedLeaveRequests(): Promise<LeaveRequest[]> {
  try {
    const requests = await getLeaveRequests();
    return requests.filter((r) => r.status === 'APPROVED');
  } catch (error) {
    console.error('Error getting approved leave requests:', error);
    return [];
  }
}
