import { api } from './api';

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
}

export interface EligibleWorker {
  id: string;
  name: string;
  role: string;
  status: 'AVAILABLE' | 'OVERLAP' | 'ON_LEAVE' | 'OVER_WEEKLY_LIMIT' | 'NOT_ASSIGNED_TO_HOUSE' | 'INACTIVE';
  eligible: boolean;
  notAssignedToHouse: boolean;
}

export async function getEligibleWorkers(shiftId: string): Promise<{ workers: EligibleWorker[] }> {
  const { data } = await api.get('/shift-change/eligible-workers', { params: { shiftId } });
  return data.data;
}

export async function getSwapShifts(shiftId: string, targetWorkerId: string): Promise<{ shifts: ShiftChangeShift[] }> {
  const { data } = await api.get('/shift-change/swap-shifts', { params: { shiftId, targetWorkerId } });
  return data.data;
}

export async function requestCover(body: { shiftId: string; targetWorkerId: string; reason?: string }): Promise<ShiftChangeRequest> {
  const { data } = await api.post('/shift-change/cover', body);
  return data.data;
}

export async function requestSwap(body: { shiftId: string; targetWorkerId: string; targetShiftId: string; reason?: string }): Promise<ShiftChangeRequest> {
  const { data } = await api.post('/shift-change/swap', body);
  return data.data;
}

export async function getMyShiftChanges(): Promise<{
  sent: { total: number; items: ShiftChangeRequest[] };
  incoming: { total: number; items: ShiftChangeRequest[] };
}> {
  const { data } = await api.get('/shift-change/me');
  return data.data;
}

export async function respondToShiftChange(id: string, decision: 'ACCEPT' | 'DECLINE'): Promise<ShiftChangeRequest> {
  const { data } = await api.post(`/shift-change/${id}/respond`, { decision });
  return data.data;
}

export async function cancelShiftChange(id: string): Promise<ShiftChangeRequest> {
  const { data } = await api.post(`/shift-change/${id}/cancel`);
  return data.data;
}
