import { useUiStore } from '../../store/uiStore';

export default function ToastNotification() {
  const { toasts, removeToast } = useUiStore();
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {toasts.map((toast) => (
        <button key={toast.id} onClick={() => removeToast(toast.id)} className="w-full border border-rdb-border border-l-rdb-orange border-l-[3px] bg-rdb-surface p-3 text-left font-mono text-sm text-rdb-text">
          {toast.message}
        </button>
      ))}
    </div>
  );
}
