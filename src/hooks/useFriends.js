import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useFriendStore } from '../store/friendStore';

export function useFriends() {
  const { profile } = useAuthStore();
  const {
    setFriends, setIncomingRequests, setOutgoingRequests,
    setPresenceBatch, setMessages, addMessage, removeMessage,
  } = useFriendStore();
  const channelsRef = useRef([]);

  useEffect(() => {
    if (!profile || !supabase) return;

    const pid = profile.id;

    async function loadAll() {
      const [{ data: fRows }, { data: inRows }, { data: outRows }] = await Promise.all([
        supabase
          .from('friendships')
          .select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, rank_tier), addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, rank_tier)')
          .eq('status', 'accepted')
          .or(`requester_id.eq.${pid},addressee_id.eq.${pid}`),
        supabase
          .from('friendships')
          .select('id, requester_id, requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, rank_tier)')
          .eq('status', 'pending')
          .eq('addressee_id', pid),
        supabase
          .from('friendships')
          .select('id, addressee_id, addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, rank_tier)')
          .eq('status', 'pending')
          .eq('requester_id', pid),
      ]);

      const friends = (fRows || []).map((r) => (r.requester_id === pid ? r.addressee : r.requester)).filter(Boolean);
      setFriends(friends);
      setIncomingRequests((inRows || []).map((r) => ({ ...r.requester, friendship_id: r.id })));
      setOutgoingRequests((outRows || []).map((r) => ({ ...r.addressee, friendship_id: r.id })));

      if (friends.length > 0) {
        const { data: pRows } = await supabase
          .from('user_presence')
          .select('user_id, last_seen_at')
          .in('user_id', friends.map((f) => f.id));
        setPresenceBatch(pRows || []);
      }
    }

    loadAll();

    const friendsCh = supabase
      .channel(`friends-${pid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `requester_id=eq.${pid}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${pid}` }, loadAll)
      .subscribe();

    const msgCh = supabase
      .channel(`fmsgs-${pid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_messages', filter: `receiver_id=eq.${pid}` }, (p) => addMessage(p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_messages', filter: `sender_id=eq.${pid}` }, (p) => addMessage(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friend_messages' }, (p) => removeMessage(p.old.id))
      .subscribe();

    const presCh = supabase
      .channel('presence-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, (p) => {
        const u = p.new || p.old;
        if (u?.user_id) setPresenceBatch([{ user_id: u.user_id, last_seen_at: u.last_seen_at }]);
      })
      .subscribe();

    channelsRef.current = [friendsCh, msgCh, presCh];

    return () => {
      for (const ch of channelsRef.current) supabase.removeChannel(ch);
      channelsRef.current = [];
    };
  }, [profile?.id]);
}
