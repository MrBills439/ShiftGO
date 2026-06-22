import { create } from 'zustand';
import { ToastData, ToastType } from '@/components/ui/Toast';

interface ToastState {
  toasts: ToastData[];
  toast: (type: ToastType, message: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  toast: (type, message) => {
    const id = `${Date.now()}-${Math.random()}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const useToast = () => {
  const { toast } = useToastStore();
  return {
    success: (msg: string) => toast('success', msg),
    error:   (msg: string) => toast('error', msg),
    info:    (msg: string) => toast('info', msg),
  };
};
