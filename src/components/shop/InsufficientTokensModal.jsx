import ConfirmModal from '../ui/ConfirmModal';

export default function InsufficientTokensModal({ open, onClose }) {
  return (
    <ConfirmModal open={open} title="NOT ENOUGH RDB" onCancel={onClose} onConfirm={onClose} confirmLabel="OK">
      Earn more RDB by entering battles, submitting beats, voting, and winning.
    </ConfirmModal>
  );
}
