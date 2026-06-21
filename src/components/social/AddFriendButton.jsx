import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';

export default function AddFriendButton({ targetUserId }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [status, setStatus] = useState('');
  const [incoming, setIncoming] = useState(false);
  const [friendshipId, setFriendshipId] = useState(null);

  useEffect(() => {
    loadStatus();
  }, [profile?.id, targetUserId]);

  if (!profile || !targetUserId || profile.id === targetUserId) return null;

  async function loadStatus() {
    if (!profile || !targetUserId) return;
    const { data } = await supabase
      .from('friendships')
      .select('id, status, requester_id, addressee_id')
      .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${profile.id})`)
      .maybeSingle();
    setFriendshipId(data?.id || null);
    setStatus(data?.status || '');
    setIncoming(Boolean(data && data.addressee_id === profile.id));
  }

  async function addFriend() {
    playUiSound('click');
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: profile.id, addressee_id: targetUserId, status: 'pending',
      });
      if (error) throw error;
      setStatus('pending');
      addToast('FRIEND REQUEST SENT');
    } catch (err) {
      addToast(err.message || 'FRIEND REQUEST FAILED', 'error');
    }
  }

  async function acceptFriend() {
    playUiSound('success');
    try {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('requester_id', targetUserId)
        .eq('addressee_id', profile.id);
      if (error) throw error;
      setStatus('accepted');
      addToast('FRIEND ADDED');
    } catch (err) {
      addToast(err.message || 'ACCEPT FAILED', 'error');
    }
  }

  async function declineFriend() {
    playUiSound('cancel');
    if (!friendshipId) return;
    try {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw error;
      setStatus('');
      addToast('REQUEST DECLINED');
    } catch (err) {
      addToast(err.message || 'DECLINE FAILED', 'error');
    }
  }

  async function cancelRequest() {
    playUiSound('cancel');
    if (!friendshipId) return;
    try {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw error;
      setStatus('');
      addToast('REQUEST CANCELLED');
    } catch (err) {
      addToast(err.message || 'CANCEL FAILED', 'error');
    }
  }

  async function unfriend() {
    playUiSound('cancel');
    if (!friendshipId) return;
    try {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw error;
      setStatus('');
      addToast('FRIEND REMOVED');
    } catch (err) {
      addToast(err.message || 'UNFRIEND FAILED', 'error');
    }
  }

  async function blockUser() {
    playUiSound('cancel');
    if (!friendshipId) return;
    try {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'blocked' })
        .eq('id', friendshipId);
      if (error) throw error;
      setStatus('blocked');
      addToast('USER BLOCKED');
    } catch (err) {
      addToast(err.message || 'BLOCK FAILED', 'error');
    }
  }

  if (status === 'blocked') return <span className="apple-chip border-rdb-red text-rdb-red">Blocked</span>;
  if (status === 'accepted') return null;
  if (status === 'pending' && incoming) return (
    <div className="flex gap-1">
      <button className="rdb-button rdb-button-primary" type="button" onClick={acceptFriend}>Accept</button>
      <button className="rdb-button" type="button" onClick={declineFriend}>Decline</button>
    </div>
  );
  if (status === 'pending') return (
    <div className="flex gap-1">
      <span className="apple-chip">Pending</span>
      <button className="rdb-button text-[10px]" type="button" onClick={cancelRequest}>Cancel</button>
    </div>
  );

  return <button className="rdb-button rdb-button-primary" type="button" onClick={addFriend}>Add Friend</button>;
}
