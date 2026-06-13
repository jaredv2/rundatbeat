import { useEffect } from 'react';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';

function Toast({ toast, onRemove }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <button
      onClick={() => { playUiSound('click'); onRemove(toast.id); }}
      className="w-full border border-rdb-border bg-rdb-surface p-3 text-left font-mono text-sm text-rdb-text transition-opacity hover:opacity-80"
    >
      {toast.message}
    </button>
  );
}

export default function ToastNotification() {
  const { toasts, removeToast } = useUiStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
