import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';

export default function SocialHub({ producers = [] }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [rooms, setRooms] = useState([]);
  const [roomName, setRoomName] = useState('BEAT LOBBY');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomBody, setRoomBody] = useState('');
  const [friend, setFriend] = useState(null);
  const [acceptedFriends, setAcceptedFriends] = useState([]);
  const [friendMessages, setFriendMessages] = useState([]);
  const [friendBody, setFriendBody] = useState('');

  const friends = useMemo(() => {
    if (acceptedFriends.length) return acceptedFriends;
    return producers.filter((user) => user.id !== profile?.id).slice(0, 6);
  }, [acceptedFriends, producers, profile?.id]);

  useEffect(() => {
    loadRooms();
    loadFriends();
  }, [profile?.id]);

  useEffect(() => {
    if (selectedRoom) loadRoomMessages(selectedRoom.id);
  }, [selectedRoom?.id]);

  useEffect(() => {
    if (friend) loadFriendMessages(friend.id);
  }, [friend?.id]);

  async function loadRooms() {
    try {
      const { data, error } = await supabase.from('rooms').select('*, room_members(count)').in('status', ['open', 'locked']).order('created_at', { ascending: false }).limit(8);
      if (error) throw error;
      setRooms(data || []);
      setSelectedRoom((current) => current || data?.[0] || null);
    } catch {
      setRooms([]);
    }
  }

  async function loadFriends() {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, elo, rank_tier), addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, elo, rank_tier)')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`);
      if (error) throw error;
      setAcceptedFriends((data || []).map((row) => row.requester_id === profile.id ? row.addressee : row.requester).filter(Boolean));
    } catch {
      setAcceptedFriends([]);
    }
  }

  async function createRoom() {
    playUiSound('click');
    if (!profile || !roomName.trim()) return;
    try {
      const { data, error } = await supabase.from('rooms').insert({ name: roomName.trim().toUpperCase(), owner_id: profile.id, max_players: 4, current_players: 1 }).select('*').single();
      if (error) throw error;
      const { error: memberErr } = await supabase.from('room_members').insert({ room_id: data.id, user_id: profile.id, role: 'owner' });
      if (memberErr && memberErr.code !== '23505') throw memberErr;
      setRooms([data, ...rooms]);
      setSelectedRoom(data);
      addToast('ROOM CREATED');
    } catch (error) {
      addToast(error.message || 'ROOM CREATE FAILED', 'error');
    }
  }

  async function joinRoom(room) {
    playUiSound('click');
    if (!profile) return;
    try {
      await supabase.from('room_members').upsert({ room_id: room.id, user_id: profile.id, role: room.owner_id === profile.id ? 'owner' : 'member' });
      const currentPlayers = Math.min(room.max_players || 4, Math.max(room.current_players || 0, (room.room_members?.[0]?.count || 0) + 1));
      await supabase.from('rooms').update({ current_players: currentPlayers }).eq('id', room.id);
      setSelectedRoom(room);
      addToast('ROOM JOINED');
    } catch (error) {
      addToast(error.message || 'JOIN FAILED', 'error');
    }
  }

  async function closeRoom(room) {
    playUiSound('click');
    if (!profile || room.owner_id !== profile.id) return;
    try {
      const { error } = await supabase.from('rooms').update({ status: room.status === 'locked' ? 'open' : 'locked' }).eq('id', room.id);
      if (error) throw error;
      loadRooms();
    } catch (error) {
      addToast(error.message || 'ROOM UPDATE FAILED', 'error');
    }
  }

  async function removeRoom(room) {
    playUiSound('cancel');
    if (!profile || room.owner_id !== profile.id) return;
    try {
      const { error } = await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
      if (error) throw error;
      if (selectedRoom?.id === room.id) setSelectedRoom(null);
      loadRooms();
      addToast('ROOM REMOVED');
    } catch (error) {
      addToast(error.message || 'ROOM REMOVE FAILED', 'error');
    }
  }

  async function loadRoomMessages(roomId) {
    try {
      const { data, error } = await supabase.from('room_messages').select('*, profiles(username)').eq('room_id', roomId).order('created_at', { ascending: true }).limit(30);
      if (error) throw error;
      setRoomMessages(data || []);
    } catch {
      setRoomMessages([]);
    }
  }

  async function sendRoomMessage() {
    playUiSound('click');
    if (!profile || !selectedRoom || !roomBody.trim()) return;
    const body = roomBody.trim();
    setRoomBody('');
    try {
      const { data: roomCheck } = await supabase.from('rooms').select('id').eq('id', selectedRoom.id).maybeSingle();
      if (!roomCheck) { addToast('ROOM NO LONGER EXISTS', 'error'); return; }
      const { error } = await supabase.from('room_messages').insert({ room_id: selectedRoom.id, user_id: profile.id, body });
      if (error) throw error;
      loadRoomMessages(selectedRoom.id);
    } catch (error) {
      addToast(error.message || 'MESSAGE FAILED', 'error');
    }
  }

  async function loadFriendMessages(friendId) {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('friend_messages')
        .select('*')
        .or(`and(sender_id.eq.${profile.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${profile.id})`)
        .order('created_at', { ascending: true })
        .limit(30);
      if (error) throw error;
      setFriendMessages(data || []);
    } catch {
      setFriendMessages([]);
    }
  }

  async function sendFriendMessage() {
    playUiSound('click');
    if (!profile || !friend || !friendBody.trim()) return;
    const body = friendBody.trim();
    setFriendBody('');
    try {
      const { error } = await supabase.from('friend_messages').insert({ sender_id: profile.id, receiver_id: friend.id, body });
      if (error) throw error;
      loadFriendMessages(friend.id);
    } catch (error) {
      addToast(error.message || 'DM FAILED', 'error');
    }
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="rdb-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="rdb-section-title">ROOM MANAGEMENT</h2>
          <div className="flex gap-2">
            <input className="rdb-input max-w-[180px]" value={roomName} onChange={(event) => setRoomName(event.target.value)} />
            <button className="rdb-button border-rdb-orange text-rdb-orange" type="button" onClick={createRoom}>CREATE</button>
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          {rooms.map((room) => (
            <div className="grid items-center gap-2 border-t border-rdb-border py-2 font-mono text-[11px] uppercase md:grid-cols-[1fr_70px_70px_auto_auto_auto]" key={room.id}>
              {room.status === 'lobby' ? (
                <button className={`text-left ${selectedRoom?.id === room.id ? 'text-rdb-orange' : 'text-rdb-text'}`} type="button" onClick={() => joinRoom(room)}>{room.name}</button>
              ) : (
                <span className="text-rdb-muted">{room.name}</span>
              )}
              <span className="text-rdb-muted">{room.status}</span>
              <span className="text-rdb-muted">{room.room_members?.[0]?.count || room.current_players || 0}/{room.max_players || 4}</span>
              {room.status === 'lobby' ? (
                <button className="rdb-button" type="button" onClick={() => joinRoom(room)}>JOIN</button>
              ) : (
                <span className="rdb-button opacity-50 cursor-not-allowed text-rdb-muted">{room.status.toUpperCase()}</span>
              )}
              {room.owner_id === profile?.id && <button className="rdb-button" type="button" onClick={() => closeRoom(room)}>{room.status === 'locked' ? 'OPEN' : 'LOCK'}</button>}
              {room.owner_id === profile?.id && <button className="rdb-button" type="button" onClick={() => removeRoom(room)}>REMOVE</button>}
            </div>
          ))}
          {!rooms.length && <div className="border-t border-rdb-border py-3 font-mono text-[11px] uppercase text-rdb-muted">NO ROOMS YET.</div>}
        </div>

        <div className="mt-5 border border-rdb-border bg-rdb-surface p-3">
          <div className="font-mono text-[11px] uppercase text-rdb-orange">{selectedRoom?.name || 'ROOM CHAT'}</div>
          <div className="mt-3 h-32 overflow-y-auto border-y border-rdb-border py-2 font-mono text-[11px] uppercase">
            {roomMessages.map((message) => (
              <div className="mb-2" key={message.id}><span className="text-rdb-orange">{message.profiles?.username || 'USER'}:</span> <span className="text-rdb-muted">{message.body}</span></div>
            ))}
            {!roomMessages.length && <div className="text-rdb-muted">NO CHAT YET.</div>}
          </div>
          <div className="mt-3 flex gap-2">
            <input className="rdb-input" placeholder="ROOM MESSAGE" value={roomBody} onChange={(event) => setRoomBody(event.target.value)} />
            <button className="rdb-button border-rdb-orange text-rdb-orange" type="button" onClick={sendRoomMessage}>SEND</button>
          </div>
        </div>
      </div>

      <aside className="rdb-panel p-4">
        <h2 className="rdb-section-title">FRIENDS</h2>
        <div className="grid gap-2">
          {friends.map((user) => (
            <button className={`flex h-9 items-center gap-2 border px-2 text-left font-mono text-[11px] uppercase ${friend?.id === user.id ? 'border-rdb-orange text-rdb-orange' : 'border-rdb-border text-rdb-text'}`} key={user.id} type="button" onClick={() => { playUiSound('click'); setFriend(user); }}>
              {user.avatar_url && <img loading="lazy" className="h-5 w-5 border border-rdb-border" src={user.avatar_url} alt="" />}
              <span>{user.username}</span>
            </button>
          ))}
          {!friends.length && <div className="font-mono text-[11px] uppercase text-rdb-muted">NO FRIENDS ONLINE.</div>}
        </div>
        <div className="mt-4 border-t border-rdb-border pt-3">
          <div className="font-mono text-[11px] uppercase text-rdb-orange">{friend ? `${friend.username} CHAT` : 'FRIEND CHAT'}</div>
          <div className="mt-2 h-28 overflow-y-auto bg-rdb-surface p-2 font-mono text-[11px] uppercase">
            {friendMessages.map((message) => <div className="mb-2 text-rdb-muted" key={message.id}>{message.sender_id === profile?.id ? 'YOU' : friend?.username}: {message.body}</div>)}
            {!friendMessages.length && <div className="text-rdb-muted">SELECT A FRIEND.</div>}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="rdb-input" placeholder="DM" value={friendBody} onChange={(event) => setFriendBody(event.target.value)} />
            <button className="rdb-button" type="button" onClick={sendFriendMessage}>SEND</button>
          </div>
        </div>
      </aside>
    </section>
  );
}
