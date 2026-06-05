import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TokenBadge from '../components/tokens/TokenBadge';
import { formatNumber } from '../lib/display';
import { supabase } from '../lib/supabase';
import { useUiStore } from '../store/uiStore';

const ACTIVE_ROOM_STATUSES = ['open', 'locked'];

export default function Admin() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [accessError, setAccessError] = useState('');
  const [battles, setBattles] = useState([]);
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [queues, setQueues] = useState([]);
  const [presence, setPresence] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [items, setItems] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reasonFilter, setReasonFilter] = useState('shop_purchase');
  const addToast = useUiStore((s) => s.addToast);

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const activePlayers = useMemo(() => {
    const since = Date.now() - 2 * 60 * 1000;
    return presence
      .filter((row) => new Date(row.last_seen_at).getTime() >= since)
      .map((row) => userById.get(row.user_id))
      .filter(Boolean);
  }, [presence, userById]);
  const stats = useMemo(() => {
    const activeBattles = battles.filter((battle) => ['active', 'voting'].includes(battle.status));
    const closedBattles = battles.filter((battle) => battle.status === 'closed');
    const totalSubmissions = battles.reduce((sum, battle) => sum + (battle.submissions?.[0]?.count || 0), 0);
    const totalVotes = battles.reduce((sum, battle) => sum + (battle.votes?.[0]?.count || 0), 0);
    return {
      activeBattles: activeBattles.length,
      closedBattles: closedBattles.length,
      totalSubmissions,
      totalVotes,
      avgVotes: totalSubmissions ? Math.round(totalVotes / totalSubmissions) : 0,
    };
  }, [battles]);

  async function load() {
    if (!supabase) return;
    const [battleRows, userRows, roomRows, queueRows, presenceRows, txRows, itemRows, reviewRows] = await Promise.all([
      supabase.from('battles').select('*, submissions(count), votes(count)').order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('rooms').select('*, room_members(count)').in('status', ACTIVE_ROOM_STATUSES).order('created_at', { ascending: false }),
      supabase.from('matchmaking_queue').select('*, profiles(username, rank_tier)').eq('status', 'waiting').order('queued_at', { ascending: true }),
      supabase.from('user_presence').select('*').order('last_seen_at', { ascending: false }),
      supabase.from('token_transactions').select('*, profiles(username)').eq('reason', reasonFilter || 'shop_purchase').order('created_at', { ascending: false }).limit(200),
      supabase.from('shop_items').select('*').order('cost_tokens'),
      supabase.from('shop_review_queue').select('*, profiles(username)').eq('status', 'pending').order('purchased_at', { ascending: true }),
    ]);
    setBattles(battleRows.data || []);
    setUsers(userRows.data || []);
    setRooms(roomRows.data || []);
    setQueues(queueRows.data || []);
    setPresence(presenceRows.data || []);
    setTransactions(txRows.data || []);
    setItems(itemRows.data || []);
    setReviewQueue(reviewRows.data || []);
  }

  useEffect(() => { if (isUnlocked) load(); }, [isUnlocked, reasonFilter]);

  function verifyAccess(event) {
    event.preventDefault();
    if (accessKey === import.meta.env.VITE_ADMIN_KEY) {
      setAccessError('');
      setIsUnlocked(true);
      return;
    }
    setAccessError('INVALID KEY');
  }

  async function adjust(user, amount) {
    const next = Number(amount);
    if (!next) return;
    await supabase.from('token_transactions').insert({ user_id: user.id, amount: next, reason: next > 0 ? 'admin_grant' : 'admin_remove' });
    addToast('PLAYER BALANCE UPDATED');
    load();
  }

  async function banUser(user) {
    const bannedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('profiles').update({ banned_until: bannedUntil, ban_reason: 'admin action' }).eq('id', user.id);
    addToast('USER BANNED');
    load();
  }

  async function unbanUser(user) {
    await supabase.from('profiles').update({ banned_until: null, ban_reason: null }).eq('id', user.id);
    addToast('USER UNBANNED');
    load();
  }

  async function removeRoom(room) {
    await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
    addToast('ROOM REMOVED');
    load();
  }

  async function removeQueue(row) {
    await supabase.from('matchmaking_queue').update({ status: 'cancelled' }).eq('id', row.id);
    addToast('QUEUE REMOVED');
    load();
  }

  async function approveReview(row) {
    const update = row.item_type === 'custom_badge'
      ? { custom_badge: row.item_data?.badge_text }
      : { nameplate_icon: row.item_data?.icon };
    await supabase.from('profiles').update(update).eq('id', row.user_id);
    await supabase.from('shop_review_queue').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', row.id);
    addToast('CUSTOM ITEM APPROVED');
    load();
  }

  async function rejectReview(row, adminNote) {
    const item = items.find((next) => next.item_type === row.item_type);
    await supabase.from('shop_review_queue').update({ status: 'rejected', admin_note: adminNote, reviewed_at: new Date().toISOString() }).eq('id', row.id);
    await supabase.from('token_transactions').insert({ user_id: row.user_id, amount: item?.cost_tokens || 0, reason: 'refund' });
    addToast('CUSTOM ITEM REJECTED');
    load();
  }

  async function removeCustoms(user) {
    await supabase.from('profiles').update({ custom_badge: null, nameplate_icon: null }).eq('id', user.id);
    addToast('CUSTOM BADGES REMOVED');
    load();
  }

  if (!isUnlocked) {
    return (
      <main className="grid min-h-[70vh] place-items-center px-4 py-12">
        <form className="w-full max-w-[360px] border border-rdb-border bg-rdb-surface p-5" onSubmit={verifyAccess}>
          <h1 className="font-mono text-[13px] uppercase leading-none text-rdb-orange">ADMIN ACCESS</h1>
          <p className="mt-3 font-mono text-[11px] uppercase text-rdb-muted">ENTER ACCESS KEY TO CONTINUE</p>
          <input
            className={`mt-5 w-full border bg-rdb-bg p-3 font-mono text-sm text-rdb-text outline-none placeholder:text-rdb-muted focus:border-rdb-orange focus:shadow-[0_0_0_1px_#FF8C00] ${accessError ? 'border-rdb-red' : 'border-rdb-orange'}`}
            type="password"
            placeholder="ACCESS KEY"
            value={accessKey}
            onChange={(event) => {
              setAccessKey(event.target.value);
              setAccessError('');
            }}
          />
          {accessError && <div className="mt-2 font-mono text-xs uppercase text-rdb-red">{accessError}</div>}
          <button className="rdb-button mt-4 w-full border-rdb-orange text-rdb-orange" type="submit">VERIFY</button>
        </form>
      </main>
    );
  }

  return (
    <main className="rdb-container-admin space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="rdb-section-title">ADMIN</h1>
        <button className="rdb-button" type="button" onClick={load}>REFRESH</button>
      </div>

      <section className="grid gap-4 md:grid-cols-5">
        <Stat label="active players" value={activePlayers.length} />
        <Stat label="active queues" value={queues.length} />
        <Stat label="active rooms" value={rooms.length} />
        <Stat label="active games" value={stats.activeBattles} />
        <Stat label="avg votes/sub" value={stats.avgVotes} />
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">ACTIVE PLAYERS</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {activePlayers.map((user) => <PlayerLine key={user.id} user={user} />)}
          {!activePlayers.length && <Empty label="NO ACTIVE PLAYERS." />}
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">ACTIVE QUEUES</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="rdb-table min-w-[720px]">
            <tbody>
              {queues.map((row) => (
                <tr key={row.id}>
                  <td>{row.profiles?.username || row.user_id}</td>
                  <td>{row.mode === 'ranked' ? 'ranked' : 'casual'}</td>
                  <td>{row.profiles?.rank_tier || 'bronze'}</td>
                  <td>{formatNumber(row.elo)}</td>
                  <td>{new Date(row.queued_at).toLocaleString()}</td>
                  <td><button className="rdb-button" type="button" onClick={() => removeQueue(row)}>REMOVE QUEUE</button></td>
                </tr>
              ))}
              {!queues.length && <tr><td className="text-rdb-muted">NO ACTIVE QUEUES.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">ACTIVE ROOMS</h2>
        <div className="mt-3 grid gap-2">
          {rooms.map((room) => (
            <div className="grid gap-2 border-t border-rdb-border py-3 font-mono text-[11px] uppercase md:grid-cols-[1fr_90px_90px_130px] md:items-center" key={room.id}>
              <span>{room.name}</span>
              <span>{room.mode || 'quick'}</span>
              <span>{room.room_members?.[0]?.count || room.current_players || 0}/{room.max_players || 4}</span>
              <button className="rdb-button" type="button" onClick={() => removeRoom(room)}>REMOVE ROOM</button>
            </div>
          ))}
          {!rooms.length && <Empty label="NO ACTIVE ROOMS." />}
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">PLAYER LIST</h2>
        <div className="mt-4 grid gap-2">{users.map((user) => <UserAdjust key={user.id} user={user} onAdjust={adjust} onBan={banUser} onUnban={unbanUser} onRemoveCustoms={removeCustoms} />)}</div>
      </section>

      <section className="rdb-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="rdb-section-title">SHOP TRANSACTIONS</h2>
          <input className="rdb-input max-w-sm" placeholder="TRANSACTION REASON" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} />
        </div>
        <div className="mt-4 grid gap-2">{transactions.map((tx) => <div className="grid gap-2 border-t border-rdb-border py-2 font-mono text-sm md:grid-cols-5" key={tx.id}><span>{tx.profiles?.username}</span><span>{tx.amount}</span><span>{tx.reason}</span><span>{tx.battle_id}</span><span>{new Date(tx.created_at).toLocaleString()}</span></div>)}</div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">GAME STATS AND INSIGHTS</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="closed games" value={stats.closedBattles} />
          <Stat label="submissions" value={stats.totalSubmissions} />
          <Stat label="votes" value={stats.totalVotes} />
          <Stat label="players" value={users.length} />
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">REVIEW CUSTOM BADGES</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="rdb-table min-w-[820px]">
            <tbody>
              {reviewQueue.map((row) => <ReviewRow key={row.id} row={row} onApprove={approveReview} onReject={rejectReview} />)}
              {!reviewQueue.length && <tr><td className="h-9 border-t border-rdb-border text-rdb-muted">NO CUSTOM BADGES PENDING.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return <div className="rdb-panel p-4"><div className="font-mono text-xs uppercase text-rdb-muted">{label}</div><div className="mt-2 font-mono text-2xl text-rdb-orange">{formatNumber(value)}</div></div>;
}

function Empty({ label }) {
  return <div className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">{label}</div>;
}

function PlayerLine({ user }) {
  return <Link className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase hover:border-rdb-orange" to={`/profile/${user.username}`}>{user.username} - {user.rank_tier || 'bronze'}</Link>;
}

function UserAdjust({ user, onAdjust, onBan, onUnban, onRemoveCustoms }) {
  const [amount, setAmount] = useState('');
  const banned = user.banned_until && new Date(user.banned_until).getTime() > Date.now();
  return (
    <div className="grid gap-2 border-t border-rdb-border py-3 md:grid-cols-[1fr_80px_100px_90px_90px_90px_90px] md:items-center">
      <Link className="font-mono hover:text-rdb-orange" to={`/profile/${user.username}`}>{user.username}</Link>
      <span>{user.wins} wins</span>
      <span><TokenBadge amount={user.tokens} /></span>
      <input className="rdb-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+/-" />
      <button className="rdb-button" onClick={() => onAdjust(user, amount)}>APPLY</button>
      {banned ? <button className="rdb-button" onClick={() => onUnban(user)}>UNBAN</button> : <button className="rdb-button" onClick={() => onBan(user)}>BAN</button>}
      <button className="rdb-button" onClick={() => onRemoveCustoms(user)}>BADGES</button>
    </div>
  );
}

function ReviewRow({ row, onApprove, onReject }) {
  const [note, setNote] = useState(row.admin_note || '');
  const content = row.item_type === 'custom_badge' ? row.item_data?.badge_text : row.item_data?.icon;
  return (
    <tr className="h-9 border-t border-rdb-border">
      <td>{row.profiles?.username || 'UNKNOWN'}</td>
      <td>{row.item_type}</td>
      <td>{content}</td>
      <td>{new Date(row.purchased_at).toLocaleDateString()}</td>
      <td><input className="rdb-input my-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="REJECT NOTE" /></td>
      <td className="space-x-2">
        <button className="rdb-button" onClick={() => onApprove(row)}>APPROVE</button>
        <button className="rdb-button" onClick={() => onReject(row, note)}>REJECT</button>
      </td>
    </tr>
  );
}
