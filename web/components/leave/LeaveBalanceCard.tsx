'use client';
import { InfoIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/Card';
import type { LeaveBalanceSummary } from '@/types';

const METHOD_LABEL: Record<string, string> = {
  FLAT_RATE: 'Fixed monthly accrual',
  HOURLY: 'Accrued per hour worked',
  LUMP_SUM: 'Annual allowance',
};

function hrs(n: number) {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}

/** Compact PTO balance breakdown. `compact` drops the secondary grid for tight spots. */
export function LeaveBalanceCard({
  balance,
  isLoading,
  compact = false,
}: {
  balance?: LeaveBalanceSummary;
  isLoading?: boolean;
  compact?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-24 rounded bg-neutral-200" />
          <div className="h-8 w-32 rounded bg-neutral-200" />
        </div>
      </Card>
    );
  }

  if (!balance) return null;

  if (!balance.hasConfiguredProfile) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <InfoIcon size={18} className="mt-0.5 flex-shrink-0 text-fg-subtle" weight="regular" />
          <div>
            <p className="text-sm font-medium text-fg">No leave allowance policy set</p>
            <p className="mt-1 text-xs text-fg-muted">
              Your agency hasn&apos;t configured an accrual policy for you yet, so leave requests
              aren&apos;t limited by a balance. Contact HR if you expect an allowance.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const rows: [string, string][] = [
    ['Carried over', hrs(balance.carriedOverHours)],
    ['Accrued to date', hrs(balance.accruedToDate)],
    ['Approved taken', `−${hrs(balance.approvedTaken)}`],
    ['Pending requests', `−${hrs(balance.pendingScheduled)}`],
  ];

  const negative = balance.netUsableBalance < 0;

  return (
    <Card className="p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Leave balance</p>
          <p className={`mt-1 font-inter text-3xl font-bold ${negative ? 'text-danger-text' : 'text-fg'}`}>
            {hrs(balance.netUsableBalance)}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            net usable · {METHOD_LABEL[balance.method] ?? balance.method}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-fg-muted">Gross available</p>
          <p className="font-inter text-lg font-semibold text-fg">{hrs(balance.grossAvailable)}</p>
          {balance.ceilingApplied && balance.balanceCeilingHours != null && (
            <p className="text-[11px] text-warning-text">capped at {hrs(balance.balanceCeilingHours)}</p>
          )}
        </div>
      </div>

      {!compact && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-neutral-200 pt-4 sm:grid-cols-4">
          {rows.map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</p>
              <p className="mt-0.5 text-sm font-medium text-fg">{value}</p>
            </div>
          ))}
        </div>
      )}

      {balance.allowNegativeBalance && (
        <p className="mt-3 text-[11px] text-fg-subtle">
          Negative balances are permitted — you can request more than shown here.
        </p>
      )}
    </Card>
  );
}
