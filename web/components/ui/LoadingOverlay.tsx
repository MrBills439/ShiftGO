'use client';

export function LoadingOverlay({ show, label }: { show: boolean; label?: string }) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-white/80 backdrop-blur-[1px]">
      <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin" />
      {label && <p className="text-sm font-medium text-fg-muted">{label}</p>}
    </div>
  );
}
