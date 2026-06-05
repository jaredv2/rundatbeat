import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

export default function ReportButton({ reportedUserId, battleId }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('profile');
  const [details, setDetails] = useState('');

  if (!profile || profile.id === reportedUserId) return null;

  async function submit() {
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: profile.id,
        reported_user_id: reportedUserId,
        battle_id: battleId || null,
        reason,
        details,
      });
      if (error) throw error;
      addToast('REPORT SUBMITTED');
      setOpen(false);
      setDetails('');
    } catch (error) {
      addToast(error.message || 'REPORT FAILED', 'error');
    }
  }

  return (
    <div className="relative">
      <button className="rdb-button" type="button" onClick={() => setOpen(!open)}>REPORT</button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-[260px] border border-rdb-border bg-rdb-bg p-3 text-left">
          <label className="grid gap-2 font-mono text-[11px] uppercase text-rdb-muted">
            Reason
            <select className="rdb-input" value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="profile">Profile</option>
              <option value="beat">Beat</option>
              <option value="chat">Chat</option>
              <option value="other">Other</option>
            </select>
          </label>
          <textarea className="rdb-input mt-3 min-h-20" placeholder="DETAILS" value={details} onChange={(event) => setDetails(event.target.value)} />
          <div className="mt-3 flex gap-2">
            <button className="rdb-button border-rdb-orange text-rdb-orange" type="button" onClick={submit}>SEND</button>
            <button className="rdb-button" type="button" onClick={() => setOpen(false)}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}
