import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

export default function AddFriendButton({ targetUserId }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [status, setStatus] = useState('');
  const [incoming, setIncoming] = useState(false);

  useEffect(() => {
    loadStatus();
  }, [profile?.id, targetUserId]);

  if (!profile || !targetUserId || profile.id === targetUserId) return null;

  async function loadStatus() {
    if (!profile || !targetUserId) return;
    const { data } = await supabase
      .from('friendships')
      .select('status, requester_id, addressee_id')
      .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${profile.id})`)
      .maybeSingle();
    setStatus(data?.status || '');
    setIncoming(Boolean(data && data.addressee_id === profile.id));
  }

  async function addFriend() {
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: profile.id,
        addressee_id: targetUserId,
        status: 'pending',
      });
      if (error) throw error;
      setStatus('pending');
      addToast('FRIEND REQUEST SENT');
    } catch (error) {
      addToast(error.message || 'FRIEND REQUEST FAILED', 'error');
    }
  }

  async function acceptFriend() {
    try {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('requester_id', targetUserId)
        .eq('addressee_id', profile.id);
      if (error) throw error;
      setStatus('accepted');
      addToast('FRIEND ADDED');
    } catch (error) {
      addToast(error.message || 'ACCEPT FAILED', 'error');
    }
  }

  if (status === 'accepted') return <span className="apple-chip">Friend</span>;
  if (status === 'pending' && incoming) return <button className="rdb-button" type="button" onClick={acceptFriend}>Accept Friend</button>;
  if (status === 'pending') return <span className="apple-chip">Pending</span>;

  return <button className="rdb-button rdb-button-primary" type="button" onClick={addFriend}>Add Friend</button>;
}
