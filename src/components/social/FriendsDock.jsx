import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFriends } from '../../hooks/useFriends';
import { createRoom } from '../../lib/roomService';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useFriendStore } from '../../store/friendStore';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';
import { pushNotification } from '../../lib/pushNotification';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export default function FriendsDock() {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const friends = useFriendStore((s) => s.friends);
  const incomingRequests = useFriendStore((s) => s.incomingRequests);
  const outgoingRequests = useFriendStore((s) => s.outgoingRequests);
  const messagesByFriend = useFriendStore((s) => s.messagesByFriend);
  const presence = useFriendStore((s) => s.presence);
  const selectedFriendId = useFriendStore((s) => s.selectedFriendId);
  const unreadByFriend = useFriendStore((s) => s.unreadByFriend);
  const setSelectedFriendId = useFriendStore((s) => s.setSelectedFriendId);
  const setMessages = useFriendStore((s) => s.setMessages);
  const clearUnread = useFriendStore((s) => s.clearUnread);
  const removeFriend = useFriendStore((s) => s.removeFriend);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('friends');
  const [body, setBody] = useState('');
  const [challenges, setChallenges] = useState([]);
  const [activeGame, setActiveGame] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const navigate = useNavigate();

  useFriends();

  const selectedFriend = useMemo(() => friends.find((f) => f.id === selectedFriendId), [friends, selectedFriendId]);
  const messages = useMemo(() => messagesByFriend[selectedFriendId] || [], [messagesByFriend, selectedFriendId]);
  const totalUnread = useMemo(() => Object.values(unreadByFriend).reduce((a, b) => a + b, 0), [unreadByFriend]);

  const pendingChallenge = useMemo(() => {
    if (!selectedFriendId || !challenges.length) return null;
    return challenges.find(
      (c) => c.status === 'pending' &&
        ((c.challenger_id === profile.id && c.challengee_id === selectedFriendId) ||
         (c.challengee_id === profile.id && c.challenger_id === selectedFriendId))
    );
  }, [challenges, selectedFriendId, profile?.id]);

  const incomingChallengeByFriend = useMemo(() => {
    if (!challenges.length || !profile) return {};
    const map = {};
    for (const c of challenges) {
      if (c.status === 'pending' && c.challengee_id === profile.id) {
        map[c.challenger_id] = c;
      }
    }
    return map;
  }, [challenges, profile?.id]);

  useEffect(() => {
    if (!selectedFriendId) return;
    loadMessages(selectedFriendId);
  }, [selectedFriendId]);

  useEffect(() => {
    if (!profile) return;
    loadChallenges();
    const ch = supabase
      .channel('challenges-' + profile.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challenger_id=eq.${profile.id}` }, () => loadChallenges())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challengee_id=eq.${profile.id}` }, () => loadChallenges())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]);

  useEffect(() => {
    const acc = challenges.find(
      (c) => c.status === 'accepted' && c.battle_id &&
        (c.challenger_id === profile?.id || c.challengee_id === profile?.id)
    );
    if (acc) {
      setOpen(false);
      navigate(`/battle/${acc.battle_id}`);
    }
  }, [challenges, profile?.id]);

  useEffect(() => {
    if (!profile) return;
    checkActiveGame();
    const ch = supabase
      .channel('active-game-' + profile.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `user_id=eq.${profile.id}` }, () => checkActiveGame())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchmaking_queue', filter: `user_id=eq.${profile.id}` }, () => checkActiveGame())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]);

  if (!profile) return null;

  async function loadMessages(friendId) {
    setLoadingMessages(true);
    try {
      const { data } = await supabase
        .from('friend_messages')
        .select('*')
        .or(`and(sender_id.eq.${profile.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${profile.id})`)
        .order('created_at', { ascending: true })
        .limit(50);
      setMessages(friendId, data || []);
    } catch {
      // Silently handle — messages may arrive via realtime
    } finally {
      setLoadingMessages(false);
    }
  }

  async function selectFriend(friendId) {
    playUiSound('click');
    setSelectedFriendId(friendId);
    setView('chat');
    clearUnread(friendId);
    await supabase
      .from('friend_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId)
      .eq('receiver_id', profile.id)
      .is('read_at', null);
  }

  async function sendMessage() {
    playUiSound('click');
    if (!selectedFriendId || !body.trim()) return;
    const text = body.trim().slice(0, 500);
    setBody('');
    try {
      const { error } = await supabase.from('friend_messages').insert({
        sender_id: profile.id, receiver_id: selectedFriendId, body: text,
      });
      if (error) throw error;
    } catch (err) {
      addToast(err.message || 'MESSAGE FAILED', 'error');
    }
  }

  async function deleteMessage(messageId) {
    playUiSound('cancel');
    try {
      const { error } = await supabase.from('friend_messages').delete().eq('id', messageId).eq('sender_id', profile.id);
      if (error) throw error;
    } catch (err) {
      addToast(err.message || 'DELETE FAILED', 'error');
    }
  }

  async function acceptRequest(friendshipId) {
    playUiSound('success');
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    if (!error) addToast('FRIEND ADDED');
    else addToast(error.message, 'error');
  }

  async function declineRequest(friendshipId) {
    playUiSound('cancel');
    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
    if (!error) addToast('REQUEST DECLINED');
    else addToast(error.message, 'error');
  }

  async function cancelRequest(friendshipId) {
    playUiSound('cancel');
    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
    if (!error) addToast('REQUEST CANCELLED');
    else addToast(error.message, 'error');
  }

  async function unfriend(friendId) {
    playUiSound('cancel');
    const { error } = await supabase
      .from('friendships')
      .delete()
      .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${profile.id})`);
    if (!error) {
      removeFriend(friendId);
      addToast('FRIEND REMOVED');
    } else addToast(error.message, 'error');
  }

  async function blockUser(friendId) {
    playUiSound('cancel');
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'blocked' })
      .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${profile.id})`);
    if (!error) {
      removeFriend(friendId);
      addToast('USER BLOCKED');
    } else addToast(error.message, 'error');
  }

  async function checkActiveGame() {
    if (!profile) return;
    const [{ data: members }, { data: queue }] = await Promise.all([
      supabase.from('room_members').select('room:room_id(status)').eq('user_id', profile.id),
      supabase.from('matchmaking_queue').select('id').eq('user_id', profile.id).in('status', ['waiting', 'matched']).limit(1),
    ]);
    const inRoom = (members || []).some((m) => m.room?.status && m.room.status !== 'closed');
    setActiveGame(inRoom || (queue && queue.length > 0));
  }

  async function loadChallenges() {
    if (!profile) return;
    const { data } = await supabase
      .from('challenges')
      .select('*')
      .or(`challenger_id.eq.${profile.id},challengee_id.eq.${profile.id}`)
      .order('created_at', { ascending: false })
      .limit(20);
    setChallenges(data || []);
  }

  async function sendChallenge(friendId) {
    playUiSound('click');
    try {
      const { error } = await supabase.from('challenges').insert({
        challenger_id: profile.id, challengee_id: friendId, status: 'pending',
      });
      if (error) throw error;
      addToast('CHALLENGE SENT');
      loadChallenges();
      pushNotification(friendId, {
        type: 'challenge', title: 'CHALLENGE', body: `${profile.username} challenged you to a 1v1!`,
        link: '/',
        actorId: profile.id,
      });
    } catch (err) {
      addToast(err.message || 'CHALLENGE FAILED', 'error');
    }
  }

  async function declineChallenge(challengeId) {
    playUiSound('cancel');
    try {
      const { error } = await supabase.from('challenges').update({ status: 'declined' }).eq('id', challengeId);
      if (error) throw error;
      addToast('CHALLENGE DECLINED');
      loadChallenges();
    } catch (err) {
      addToast(err.message || 'DECLINE FAILED', 'error');
    }
  }

  async function acceptChallenge(challengeId) {
    playUiSound('success');
    try {
      const challenge = challenges.find((c) => c.id === challengeId);
      if (!challenge) return;
      const otherId = challenge.challenger_id === profile.id ? challenge.challengee_id : challenge.challenger_id;
      const { error } = await supabase.from('challenges').update({ status: 'accepted' }).eq('id', challengeId).eq('status', 'pending');
      if (error) throw error;
      addToast('CHALLENGE ACCEPTED — CREATING ROOM');
      await createChallengeBattle(challengeId, profile.id, otherId);
    } catch (err) {
      addToast(err.message || 'ACCEPT FAILED', 'error');
      loadChallenges();
    }
  }

  async function createChallengeBattle(challengeId, userId1, userId2) {
    try {
      const { room } = await createRoom({
        timerEnabled: true,
        isPublic: false,
        hostId: userId1,
        maxPlayers: 2,
      });

      await supabase.from('room_members').upsert({ room_id: room.id, user_id: userId2, role: 'member', is_ready: false });
      await supabase.from('rooms').update({ current_players: 2 }).eq('id', room.id);
      await supabase.from('challenges').update({ battle_id: null }).eq('id', challengeId);

      setOpen(false);
      navigate(`/battle/${room.id}`);
    } catch (err) {
      await supabase.from('challenges').update({ status: 'declined' }).eq('id', challengeId);
      throw err;
    }
  }

  function isOnline(userId) {
    const ts = presence[userId];
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < ONLINE_WINDOW_MS;
  }

  return (
    <aside className={`friends-dock ${open ? 'friends-dock-open' : ''}`}>
      <button className="friends-dock-tab relative" type="button" onClick={() => { playUiSound('click'); setOpen(!open); }}>
        {open ? 'CLOSE' : 'FRIENDS'}
        {!open && totalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rdb-orange px-1 font-mono text-[9px] text-black">{totalUnread > 9 ? '9+' : totalUnread}</span>
        )}
      </button>

      <div className="friends-dock-panel">
        {view === 'chat' && selectedFriend ? (
          <>
            <div className="flex items-center justify-between border-b border-rdb-border pb-3">
              <button className="font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-orange" type="button" onClick={() => { playUiSound('click'); setView('friends'); }}>← BACK</button>
              <h2 className="font-mono text-[12px] uppercase text-rdb-text">{selectedFriend.username}</h2>
              <div className="flex gap-1">
                <button className="font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-red" type="button" onClick={() => unfriend(selectedFriend.id)}>UNFRIEND</button>
                <button className="font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-red" type="button" onClick={() => blockUser(selectedFriend.id)}>BLOCK</button>
              </div>
            </div>

            <div className="mt-3 h-52 overflow-y-auto border-y border-rdb-border py-2">
              {messages.map((msg) => {
                const isMine = msg.sender_id === profile.id;
                return (
                  <div className={`group mb-2 flex items-start gap-2 font-mono text-[11px] uppercase ${isMine ? 'justify-end' : ''}`} key={msg.id}>
                    <span className={`rounded px-2 py-1 ${isMine ? 'bg-rdb-orange/20 text-rdb-text' : 'bg-rdb-surface text-rdb-muted'}`}>
                      <span className={isMine ? '' : 'text-rdb-text'}>{isMine ? 'You' : selectedFriend.username}:</span> {msg.body}
                    </span>
                    {isMine && (
                      <button
                        className="hidden group-hover:inline-flex font-mono text-[9px] uppercase text-rdb-red hover:text-red-400"
                        type="button"
                        onClick={() => deleteMessage(msg.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
              {!messages.length && !loadingMessages && <div className="font-mono text-[11px] uppercase text-rdb-muted p-2">No messages yet.</div>}
              {loadingMessages && !messages.length && <div className="font-mono text-[11px] uppercase text-rdb-muted p-2">Loading...</div>}
            </div>

            {pendingChallenge && (
              <div className="mt-3 rounded-lg border border-rdb-orange/30 bg-rdb-orange/5 p-3">
                <div className="font-mono text-[11px] uppercase text-rdb-text">
                  {pendingChallenge.challenger_id === profile?.id
                    ? 'Challenge sent — waiting for response'
                    : `${selectedFriend.username} challenged you!`}
                </div>
                <div className="mt-2 flex gap-2">
                  {pendingChallenge.challenger_id !== profile?.id && (
                    <>
                      <button className="rdb-button text-[10px] border-green-600 text-green-400" type="button" onClick={() => acceptChallenge(pendingChallenge.id)}>ACCEPT</button>
                      <button className="rdb-button text-[10px] border-rdb-red text-rdb-red" type="button" onClick={() => declineChallenge(pendingChallenge.id)}>DECLINE</button>
                    </>
                  )}
                  {pendingChallenge.challenger_id === profile?.id && (
                    <button className="rdb-button text-[10px]" type="button" onClick={() => declineChallenge(pendingChallenge.id)}>CANCEL</button>
                  )}
                </div>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <input className="rdb-input" disabled={!selectedFriendId} maxLength={500} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }} />
              <button className="rdb-button rdb-button-primary" disabled={!selectedFriendId} type="button" onClick={sendMessage}>SEND</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-rdb-border pb-3">
              <div>
                <h2 className="font-mono text-[12px] uppercase text-rdb-text">Friends</h2>
                <p className="font-mono text-[10px] uppercase text-rdb-muted">{friends.length} connected</p>
              </div>
              <div className="flex gap-1">
                {(incomingRequests.length > 0 || outgoingRequests.length > 0) && (
                  <button className={`rdb-button text-[10px] ${view === 'requests' ? 'border-rdb-orange text-rdb-orange' : ''}`} type="button" onClick={() => { playUiSound('click'); setView(view === 'requests' ? 'friends' : 'requests'); }}>
                    REQUESTS{incomingRequests.length > 0 ? ` (${incomingRequests.length})` : ''}
                  </button>
                )}
              </div>
            </div>

            {view === 'requests' ? (
              <div className="mt-3 grid gap-3 max-h-[300px] overflow-y-auto">
                <div className="flex items-center justify-between pb-1">
                  <button className="font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-orange" type="button" onClick={() => { playUiSound('click'); setView('friends'); }}>← BACK</button>
                  <span className="font-mono text-[10px] uppercase text-rdb-muted">Requests</span>
                </div>
                {incomingRequests.length > 0 && (
                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase text-rdb-muted">Incoming</div>
                    {incomingRequests.map((req) => (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-rdb-border bg-rdb-bg p-2" key={req.friendship_id}>
                        <div className="flex items-center gap-2 min-w-0">
                          {req.avatar_url ? <img loading="lazy" className="h-6 w-6 rounded object-cover" src={req.avatar_url} alt="" /> : <div className="h-6 w-6 rounded bg-rdb-surface" />}
                          <span className="truncate font-mono text-[11px] uppercase text-rdb-text">{req.username}</span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button className="rdb-button text-[10px] border-green-600 text-green-400" type="button" onClick={() => acceptRequest(req.friendship_id)}>ACCEPT</button>
                          <button className="rdb-button text-[10px] border-rdb-red text-rdb-red" type="button" onClick={() => declineRequest(req.friendship_id)}>DECLINE</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {outgoingRequests.length > 0 && (
                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase text-rdb-muted">Outgoing</div>
                    {outgoingRequests.map((req) => (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-rdb-border bg-rdb-bg p-2" key={req.friendship_id}>
                        <div className="flex items-center gap-2 min-w-0">
                          {req.avatar_url ? <img loading="lazy" className="h-6 w-6 rounded object-cover" src={req.avatar_url} alt="" /> : <div className="h-6 w-6 rounded bg-rdb-surface" />}
                          <span className="truncate font-mono text-[11px] uppercase text-rdb-text">{req.username}</span>
                        </div>
                        <button className="rdb-button text-[10px] shrink-0" type="button" onClick={() => cancelRequest(req.friendship_id)}>CANCEL</button>
                      </div>
                    ))}
                  </div>
                )}
                {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                  <div className="font-mono text-[11px] uppercase text-rdb-muted p-2">No pending requests.</div>
                )}
              </div>
            ) : (
              <div className="mt-3 grid gap-2 max-h-[300px] overflow-y-auto">
                {friends.map((friend) => {
                  const online = isOnline(friend.id);
                  const unread = unreadByFriend[friend.id] || 0;
                  return (
                    <div
                      className={`relative flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-left ${selectedFriendId === friend.id ? 'border-rdb-orange bg-rdb-surface' : 'border-rdb-border bg-rdb-bg'}`}
                      key={friend.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectFriend(friend.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') selectFriend(friend.id); }}
                    >
                      <div className="relative shrink-0">
                        {friend.avatar_url ? <img loading="lazy" className="h-8 w-8 rounded-md object-cover" src={friend.avatar_url} alt="" /> : <div className="h-8 w-8 rounded-md bg-rdb-surface" />}
                        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-rdb-bg ${online ? 'bg-green-400' : 'bg-rdb-muted'}`} />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] uppercase text-rdb-text">{friend.username}</span>
                        <span className="block font-mono text-[10px] uppercase text-rdb-muted">{online ? 'online' : friend.rank_tier || 'bronze'}</span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {unread > 0 && (
                          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rdb-orange px-1 font-mono text-[9px] text-black">{unread > 9 ? '9+' : unread}</span>
                        )}
                        {activeGame ? (
                          <span className="font-mono text-[8px] uppercase text-rdb-muted">IN GAME</span>
                        ) : (() => {
                          const inc = incomingChallengeByFriend[friend.id];
                          return inc ? (
                            <div className="flex gap-1">
                              <button className="font-mono text-[9px] uppercase text-green-400 hover:text-green-300" type="button" onClick={(e) => { e.stopPropagation(); acceptChallenge(inc.id); }}>ACCEPT</button>
                              <button className="font-mono text-[9px] uppercase text-rdb-red hover:text-red-300" type="button" onClick={(e) => { e.stopPropagation(); declineChallenge(inc.id); }}>DECLINE</button>
                            </div>
                          ) : (
                            <button className="font-mono text-[9px] uppercase text-rdb-orange hover:text-orange-300" type="button" onClick={(e) => { e.stopPropagation(); sendChallenge(friend.id); }}>1V1 ME</button>
                          );
                        })()}
                        <Link className="font-mono text-[9px] uppercase text-rdb-muted hover:text-rdb-orange" to={`/profile/${friend.username}`} onClick={(e) => e.stopPropagation()}>VIEW</Link>
                      </div>
                    </div>
                  );
                })}
                {!friends.length && <div className="rounded-md border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">No friends yet.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
