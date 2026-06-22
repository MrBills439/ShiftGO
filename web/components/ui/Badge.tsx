import { clsx } from 'clsx';

type Variant = 'active' | 'upcoming' | 'completed' | 'pending' | 'confirmed' | 'error' |
               'hr' | 'manager' | 'team_leader' | 'worker';

const MAP: Record<Variant, string> = {
  active:      'bg-[#e6f4f0] text-primary-DEFAULT',
  upcoming:    'bg-[#e3f0f8] text-[#1a6b8a]',
  completed:   'bg-surface-high text-on-surface-variant',
  pending:     'bg-[#fff8e1] text-[#784a00]',
  confirmed:   'bg-[#e6f4f0] text-primary-DEFAULT',
  error:       'bg-error-container text-error-DEFAULT',
  hr:          'bg-primary-DEFAULT text-white',
  manager:     'bg-secondary-container text-secondary-DEFAULT',
  team_leader: 'bg-[#e3f0f8] text-[#1a6b8a]',
  worker:      'bg-surface-highest text-on-surface-variant',
};

const DOT: Record<Variant, string> = {
  active:      'bg-primary-DEFAULT',
  upcoming:    'bg-[#1a6b8a]',
  completed:   'bg-outline-DEFAULT',
  pending:     'bg-[#784a00]',
  confirmed:   'bg-primary-DEFAULT',
  error:       'bg-error-DEFAULT',
  hr:          'bg-white',
  manager:     'bg-secondary-DEFAULT',
  team_leader: 'bg-[#1a6b8a]',
  worker:      'bg-outline-DEFAULT',
};

interface Props {
  variant: Variant;
  label: string;
  dot?: boolean;
}

export function Badge({ variant, label, dot = true }: Props) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wider uppercase font-inter', MAP[variant])}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', DOT[variant])} />}
      {label}
    </span>
  );
}
