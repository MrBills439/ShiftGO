'use client';
import { useAuthStore } from '@/store/authStore';
import { OpsToday } from '@/components/dashboard/OpsToday';
import { WorkerToday } from '@/components/dashboard/WorkerToday';

export default function TodayPage() {
  const role = useAuthStore((s) => s.user?.role);

  // Workers get their own home — their shifts, hours, time off and notices.
  // Team leaders, managers and HR get the operations dashboard (coverage,
  // issues, approvals, shift-creation quick actions).
  return role === 'WORKER' ? <WorkerToday /> : <OpsToday />;
}
