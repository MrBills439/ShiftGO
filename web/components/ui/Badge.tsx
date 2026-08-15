import { clsx } from 'clsx';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' |
               'active' | 'upcoming' | 'completed' | 'pending' | 'confirmed' | 'error' |
               'hr' | 'manager' | 'team_leader' | 'worker';

const MAP: Record<Variant, string> = {
  success:     'bg-success-bg text-success-text border-success-border',
  warning:     'bg-warning-bg text-warning-text border-warning-border',
  danger:      'bg-danger-bg text-danger-text border-danger-border',
  info:        'bg-info-bg text-info-text border-info-border',
  neutral:     'bg-surface-muted text-fg-muted border-border',
  active:      'bg-success-bg text-success-text border-success-border',
  upcoming:    'bg-info-bg text-info-text border-info-border',
  completed:   'bg-surface-muted text-fg-muted border-border',
  pending:     'bg-warning-bg text-warning-text border-warning-border',
  confirmed:   'bg-success-bg text-success-text border-success-border',
  error:       'bg-danger-bg text-danger-text border-danger-border',
  hr:          'bg-brand-600 text-white border-brand-600',
  manager:     'bg-brand-50 text-brand-700 border-brand-200',
  team_leader: 'bg-info-bg text-info-text border-info-border',
  worker:      'bg-surface-muted text-fg-muted border-border',
};

const DOT: Record<Variant, string> = {
  success:     'bg-success-solid',
  warning:     'bg-warning-solid',
  danger:      'bg-danger-solid',
  info:        'bg-info-solid',
  neutral:     'bg-fg-subtle',
  active:      'bg-success-solid',
  upcoming:    'bg-info-solid',
  completed:   'bg-fg-subtle',
  pending:     'bg-warning-solid',
  confirmed:   'bg-success-solid',
  error:       'bg-danger-solid',
  hr:          'bg-white',
  manager:     'bg-brand-600',
  team_leader: 'bg-info-solid',
  worker:      'bg-fg-subtle',
};

interface Props {
  variant: Variant;
  label: string;
  dot?: boolean;
}

export function Badge({ variant, label, dot = true }: Props) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase font-inter', MAP[variant])}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', DOT[variant])} />}
      {label}
    </span>
  );
}
