import { Icon } from '@phosphor-icons/react';

interface Props {
  icon: Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: IconComp, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-xl bg-surface-low flex items-center justify-center mb-4">
        <IconComp size={28} className="text-outline-DEFAULT" />
      </div>
      <h3 className="text-base font-medium text-on-surface mb-1">{title}</h3>
      {description && <p className="text-sm text-on-surface-variant max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  );
}
