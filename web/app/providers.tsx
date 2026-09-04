'use client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from '@/components/ui/Toast';
import { useToastStore } from '@/hooks/useToast';
import { ClerkAuthSync } from '@/components/auth/ClerkAuthSync';

function ToastLayer() {
  const { toasts, dismiss } = useToastStore();
  return <ToastContainer toasts={toasts} onDismiss={dismiss} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={qc}>
      <ClerkAuthSync />
      {children}
      <ToastLayer />
    </QueryClientProvider>
  );
}
