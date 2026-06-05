import { create } from 'zustand';

export const useUiStore = create((set) => ({
  isLoading: false,
  toasts: [],
  setLoading: (isLoading) => set({ isLoading }),
  addToast: (message, type = 'info') => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
