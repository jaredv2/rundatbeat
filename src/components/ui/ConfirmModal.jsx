import { Check, X } from 'lucide-react';

export default function ConfirmModal({ open, title, children, onConfirm, onCancel, confirmLabel = 'CONFIRM' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="rdb-panel w-full max-w-md p-5">
        <h2 className="font-mono text-xl uppercase text-rdb-orange">{title}</h2>
        <div className="mt-4 text-rdb-text">{children}</div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button className="rdb-button w-full" type="button" onClick={onCancel}><X size={14} />CANCEL</button>
          <button className="rdb-button rdb-button-primary w-full" type="button" onClick={onConfirm}>{typeof confirmLabel === 'string' && <Check size={14} />}{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
