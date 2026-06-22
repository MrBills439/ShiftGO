import { Icon } from '@phosphor-icons/react';

interface Props {
  label: string;
  value: string | number;
  icon: Icon;
  trend?: string;
  trendUp?: boolean;
  color?: 'teal' | 'amber' | 'blue' | 'slate';
}

const COLOR_MAP = {
  teal:  { icon: 'text-primary-DEFAULT bg-[#e6f4f0]', value: 'text-primary-DEFAULT' },
  amber: { icon: 'text-[#784a00] bg-[#fff8e1]', value: 'text-[#784a00]' },
  blue:  { icon: 'text-[#1a6b8a] bg-[#e3f0f8]', value: 'text-[#1a6b8a]' },
  slate: { icon: 'text-on-surface-variant bg-surface-high', value: 'text-on-surface' },
};

export function StatsCard({ label, value, icon: IconComp, trend, trendUp, color = 'teal' }: Props) {
  const c = COLOR_MAP[color];
  return (
    <div className="glass-card p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${c.icon}`}>
        <IconComp size={22} weight="regular" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1">{label}</p>
        <p className={`text-2xl font-bold ${c.value} font-sans`}>{value}</p>
        {trend && (
          <p className={`text-xs mt-1 font-inter ${trendUp ? 'text-primary-DEFAULT' : 'text-error-DEFAULT'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </p>
        )}
      </div>
    </div>
  );
}
