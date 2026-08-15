import { api } from './api';
import { RotaWeek, Shift } from '../types';

export async function getRotaForMe(): Promise<RotaWeek> {
  const { data } = await api.get('/rota/me');
  return data.data;
}

export async function getRotaDay(date: string): Promise<Shift[]> {
  const { data } = await api.get('/rota/day', { params: { date } });
  return data.data;
}

export async function getMyShifts(): Promise<Shift[]> {
  const { data } = await api.get('/shifts');
  return data.data;
}

export async function getTodayShift(): Promise<Shift | null> {
  try {
    const shifts = await getMyShifts();
    if (!shifts || shifts.length === 0) return null;

    const today = new Date().toISOString().split('T')[0];
    const todayShift = shifts.find((s) => s.date === today && s.status !== 'CANCELLED');

    return todayShift || null;
  } catch (error) {
    console.error('Error getting today shift:', error);
    return null;
  }
}

export async function getUpcomingShift(): Promise<Shift | null> {
  try {
    const shifts = await getMyShifts();
    if (!shifts || shifts.length === 0) return null;

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Find next shift after today
    const futureShifts = shifts
      .filter((s) => {
        if (s.status === 'CANCELLED' || s.status === 'COMPLETED') return false;
        if (s.date < today) return false;
        if (s.date === today) {
          const endTime = new Date(s.endTime);
          return endTime > now; // Only if end time is in future
        }
        return true;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return futureShifts.length > 0 ? futureShifts[0] : null;
  } catch (error) {
    console.error('Error getting upcoming shift:', error);
    return null;
  }
}
