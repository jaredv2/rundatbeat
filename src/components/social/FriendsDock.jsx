import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

export default function FriendsDock() {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');

  const selectedFriend = useMemo(() => friends.find((friend) => friend.id === selected?.id) || selected, [friends, selected]);

  useEffect(() => {
    loadFriends();
    const timer = window.setInterval(loadFriends, 15000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  useEffect(() => {
    if (!selectedFriend) return undefined;
    loadMessages(selectedFriend.id);
    const timer = window.setInterval(() => loadMessages(selectedFriend.id), 7000);
    return () => window.clearInterval(timer);
  }, [selectedFriend?.id, profile?.id]);

  if (!profile) return null;

  async function loadFriends() {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, rank_tier), addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, rank_tier)')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`);
      if (error) throw error;
      setFriends((data || []).map((row) => row.requester_id === profile.id ? row.addressee : row.requester).filter(Boolean));
    } catch {
      setFriends([]);
    }
  }

  async function loadMessages(friendId) {
    if (!profile || !friendId) return;
    const { data, error } = await supabase
      .from('friend_messages')
      .select('*')
      .or(`and(sender_id.eq.${profile.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${profile.id})`)
      .order('created_at', { ascending: true })
      .limit(40);
    if (!error) setMessages(data || []);
  }

  async function sendMessage() {
    if (!selectedFriend || !body.trim()) return;
    const text = body.trim();
    setBody('');
    try {
      const { error } = await supabase.from('friend_messages').insert({
        sender_id: profile.id,
        receiver_id: selectedFriend.id,
        body: text,
      });
      if (error) throw error;
      loadMessages(selectedFriend.id);
    } catch (error) {
      addToast(error.message || 'MESSAGE FAILED', 'error');
    }
  }

  return (
    <aside className={`friends-dock ${open ? 'friends-dock-open' : ''}`}>
      <button className="friends-dock-tab" type="button" onClick={() => setOpen(!open)}>
        {open ? 'CLOSE' : 'FRIENDS'}
      </button>
      <div className="friends-dock-panel">
        <div className="flex items-center justify-between border-b border-rdb-border pb-3">
          <div>
            <h2 className="font-mono text-[12px] uppercase text-rdb-text">Friends</h2>
            <p className="font-mono text-[10px] uppercase text-rdb-muted">{friends.length} connected</p>
          </div>
          <button className="rdb-button" type="button" onClick={loadFriends}>SYNC</button>
        </div>

        <div className="mt-3 grid gap-2">
          {friends.map((friend) => (
            <button
              className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left ${selectedFriend?.id === friend.id ? 'border-rdb-orange bg-rdb-surface' : 'border-rdb-border bg-rdb-bg'}`}
              key={friend.id}
              type="button"
              onClick={() => setSelected(friend)}
            >
              {friend.avatar_url ? <img className="h-8 w-8 rounded-md object-cover" src={friend.avatar_url} alt="" /> : <div className="h-8 w-8 rounded-md bg-rdb-surface" />}
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12px] uppercase text-rdb-text">{friend.username}</span>
                <span className="block font-mono text-[10px] uppercase text-rdb-muted">{friend.rank_tier || 'bronze'}</span>
              </span>
            </button>
          ))}
          {!friends.length && <div className="rounded-md border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">No friends yet.</div>}
        </div>

        <div className="mt-4 rounded-md border border-rdb-border bg-rdb-bg p-3">
          <div className="font-mono text-[11px] uppercase text-rdb-orange">{selectedFriend ? `${selectedFriend.username} chat` : 'Select a friend'}</div>
          {selectedFriend && <Link className="mt-1 inline-block font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-orange" to={`/profile/${selectedFriend.username}`}>View profile</Link>}
          <div className="mt-3 h-52 overflow-y-auto border-y border-rdb-border py-2">
            {messages.map((message) => (
              <div className="mb-2 font-mono text-[11px] uppercase text-rdb-muted" key={message.id}>
                <span className="text-rdb-text">{message.sender_id === profile.id ? 'You' : selectedFriend?.username}:</span> {message.body}
              </div>
            ))}
            {!messages.length && <div className="font-mono text-[11px] uppercase text-rdb-muted">No messages.</div>}
          </div>
          <div className="mt-3 flex gap-2">
            <input className="rdb-input" disabled={!selectedFriend} placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} />
            <button className="rdb-button rdb-button-primary" disabled={!selectedFriend} type="button" onClick={sendMessage}>Send</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
