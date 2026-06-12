import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TokenBadge from '../components/tokens/TokenBadge';
import { formatNumber } from '../lib/display';
import { supabase } from '../lib/supabase';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { playUiSound } from '../lib/sfx';

const ACTIVE_ROOM_STATUSES = ['open', 'locked'];
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];
const TIER_COLORS = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', platinum: '#E5E4E2', diamond: '#B9F2FF', master: '#FF6B6B' };

const dayLabel = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
};

export default function Admin() {
  const { profile } = useAuthStore();
  const [battles, setBattles] = useState([]);
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [queues, setQueues] = useState([]);
  const [presence, setPresence] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [items, setItems] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [siteStats, setSiteStats] = useState([]);
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
    const activeBattles = battles.filter((b) => ['active', 'voting'].includes(b.status));
    const closedBattles = battles.filter((b) => b.status === 'closed');
    const totalSubmissions = battles.reduce((s, b) => s + (b.submissions?.[0]?.count || 0), 0);
    const totalVotes = battles.reduce((s, b) => s + (b.votes?.[0]?.count || 0), 0);
    return {
      activeBattles: activeBattles.length,
      closedBattles: closedBattles.length,
      totalSubmissions,
      totalVotes,
      avgVotes: totalSubmissions ? Math.round(totalVotes / totalSubmissions) : 0,
    };
  }, [battles]);

  const dailyBattles = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = dayLabel(6 - i);
      const count = battles.filter((b) => b.created_at?.startsWith(date)).length;
      return { date, count };
    });
  }, [battles]);

  const maxDaily = useMemo(() => Math.max(1, ...dailyBattles.map((d) => d.count)), [dailyBattles]);

  const tierDistribution = useMemo(() => {
    const map = {};
    for (const user of users) {
      const tier = user.rank_tier || 'bronze';
      map[tier] = (map[tier] || 0) + 1;
    }
    return TIER_ORDER.filter((t) => map[t]).map((tier) => ({ tier, count: map[tier] }));
  }, [users]);

  const maxTier = useMemo(() => Math.max(1, ...tierDistribution.map((t) => t.count)), [tierDistribution]);

  const modeDistribution = useMemo(() => {
    const map = {};
    for (const b of battles) {
      const mode = b.mode || 'quick';
      map[mode] = (map[mode] || 0) + 1;
    }
    return Object.entries(map).map(([mode, count]) => ({ mode, count }));
  }, [battles]);

  const maxMode = useMemo(() => Math.max(1, ...modeDistribution.map((m) => m.count)), [modeDistribution]);

  const eloBuckets = useMemo(() => {
    const buckets = [
      { label: '0-500', min: 0, max: 500 },
      { label: '500-1000', min: 500, max: 1000 },
      { label: '1000-1500', min: 1000, max: 1500 },
      { label: '1500-2000', min: 1500, max: 2000 },
      { label: '2000+', min: 2000, max: Infinity },
    ];
    return buckets.map((b) => ({
      ...b,
      count: users.filter((u) => (u.elo || 0) >= b.min && (u.elo || 0) < b.max).length,
    }));
  }, [users]);

  const maxEloBucket = useMemo(() => Math.max(1, ...eloBuckets.map((b) => b.count)), [eloBuckets]);

  const topElo = useMemo(() => {
    return [...users].sort((a, b) => (b.elo || 0) - (a.elo || 0)).slice(0, 10);
  }, [users]);

  const recentBattles = useMemo(() => battles.slice(0, 10), [battles]);

  const bannedUsers = useMemo(() => {
    const now = Date.now();
    return users.filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now);
  }, [users]);

  const avgElo = useMemo(() => {
    if (!users.length) return 0;
    return Math.round(users.reduce((s, u) => s + (u.elo || 0), 0) / users.length);
  }, [users]);

  const winRate = useMemo(() => {
    const withWins = users.filter((u) => (u.wins || 0) > 0);
    if (!withWins.length) return 0;
    const totalWins = withWins.reduce((s, u) => s + (u.wins || 0), 0);
    return Math.round(totalWins / (totalWins + withWins.filter((u) => (u.wins || 0) === 0).length) * 100);
  }, [users]);

  async function closeBattle(battle) {
    playUiSound('cancel');
    await supabase.from('battles').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', battle.id);
    addToast('BATTLE CLOSED');
    load();
  }

  async function load() {
    if (!supabase) return;
    const [battleRows, userRows, roomRows, queueRows, presenceRows, txRows, itemRows, reviewRows, statsRows] = await Promise.all([
      supabase.from('battles').select('*, submissions(count), votes(count)').order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('id, username, elo, rank_tier, wins, points, tokens, banned_until, created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('rooms').select('*, room_members(count)').in('status', ACTIVE_ROOM_STATUSES).order('created_at', { ascending: false }),
      supabase.from('matchmaking_queue').select('id, user_id, mode, status, group_id, queued_at, profiles(username, rank_tier)').eq('status', 'waiting').order('queued_at', { ascending: true }),
      supabase.from('user_presence').select('user_id, last_seen_at').order('last_seen_at', { ascending: false }).limit(100),
      supabase.from('token_transactions').select('*, profiles(username)').eq('reason', reasonFilter || 'shop_purchase').order('created_at', { ascending: false }).limit(200),
      supabase.from('shop_items').select('*').order('cost_tokens'),
      supabase.from('shop_review_queue').select('*, profiles(username)').eq('status', 'pending').order('purchased_at', { ascending: true }),
      supabase.from('site_stats').select('*'),
    ]);
    setBattles(battleRows.data || []);
    setUsers(userRows.data || []);
    setRooms(roomRows.data || []);
    setQueues(queueRows.data || []);
    setPresence(presenceRows.data || []);
    setTransactions(txRows.data || []);
    setItems(itemRows.data || []);
    setReviewQueue(reviewRows.data || []);
    setSiteStats(statsRows.data || []);
  }

  useEffect(() => { load(); }, [reasonFilter]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!supabase) return;
    loadRef.current();
    const interval = setInterval(() => loadRef.current(), 30000);
    return () => clearInterval(interval);
  }, []);

  async function adjust(user, amount) {
    playUiSound('click');
    const next = Number(amount);
    if (!next) return;
    await supabase.from('token_transactions').insert({ user_id: user.id, amount: next, reason: next > 0 ? 'admin_grant' : 'admin_remove' });
    addToast('PLAYER BALANCE UPDATED');
    load();
  }

  async function banUser(user) {
    playUiSound('click');
    const bannedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { error } = await supabase.from('profiles').update({ banned_until: bannedUntil }).eq('id', user.id);
      if (error) throw error;
      addToast('USER BANNED');
      load();
    } catch (err) {
      addToast(err.message || 'BAN FAILED', 'error');
    }
  }

  async function unbanUser(user) {
    playUiSound('click');
    try {
      const { error } = await supabase.from('profiles').update({ banned_until: null }).eq('id', user.id);
      if (error) throw error;
      addToast('USER UNBANNED');
      load();
    } catch (err) {
      addToast(err.message || 'UNBAN FAILED', 'error');
    }
  }

  async function removeRoom(room) {
    playUiSound('cancel');
    await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
    addToast('ROOM REMOVED');
    load();
  }

  async function removeQueue(row) {
    playUiSound('cancel');
    await supabase.from('matchmaking_queue').update({ status: 'cancelled' }).eq('id', row.id);
    addToast('QUEUE REMOVED');
    load();
  }

  async function approveReview(row) {
    playUiSound('click');
    const update = row.item_type === 'custom_badge'
      ? { custom_badge: row.item_data?.badge_text }
      : { nameplate_icon: row.item_data?.icon };
    await supabase.from('profiles').update(update).eq('id', row.user_id);
    await supabase.from('shop_review_queue').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', row.id);
    addToast('CUSTOM ITEM APPROVED');
    load();
  }

  async function rejectReview(row, adminNote) {
    playUiSound('cancel');
    const item = items.find((next) => next.item_type === row.item_type);
    await supabase.from('shop_review_queue').update({ status: 'rejected', admin_note: adminNote, reviewed_at: new Date().toISOString() }).eq('id', row.id);
    await supabase.from('token_transactions').insert({ user_id: row.user_id, amount: item?.cost_tokens || 0, reason: 'refund' });
    addToast('CUSTOM ITEM REJECTED');
    load();
  }

  async function removeCustoms(user) {
    playUiSound('cancel');
    await supabase.from('profiles').update({ custom_badge: null, nameplate_icon: null }).eq('id', user.id);
    addToast('CUSTOM BADGES REMOVED');
    load();
  }

  const adminUserId = import.meta.env.VITE_ADMIN_USER_ID;
  if (!profile) {
    return (
      <main className="grid min-h-[70vh] place-items-center px-4 py-12">
        <div className="w-full max-w-[360px] border border-rdb-border bg-rdb-surface p-5 text-center">
          <h1 className="font-mono text-[13px] uppercase text-rdb-orange">PLEASE LOG IN</h1>
        </div>
      </main>
    );
  }
  if (!adminUserId || profile.id !== adminUserId) {
    return (
      <main className="grid min-h-[70vh] place-items-center px-4 py-12">
        <div className="w-full max-w-[360px] border border-rdb-border bg-rdb-surface p-5 text-center">
          <h1 className="font-mono text-[13px] uppercase text-rdb-orange">NOT AUTHORIZED</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="rdb-container-admin space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="rdb-section-title">ADMIN</h1>
        <button className="rdb-button" type="button" onClick={() => { playUiSound('click'); load(); }}>REFRESH</button>
      </div>

      <section className="grid gap-4 md:grid-cols-6">
        <Stat label="active players" value={activePlayers.length} />
        <Stat label="active queues" value={queues.length} />
        <Stat label="active rooms" value={rooms.length} />
        <Stat label="active games" value={stats.activeBattles} />
        <Stat label="avg elo" value={avgElo} />
        <Stat label="avg votes/sub" value={stats.avgVotes} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rdb-panel p-3">
          <h2 className="rdb-section-title">TOTAL STATS</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center font-mono text-sm">
            <div><div className="text-xs uppercase text-rdb-muted">closed games</div><div className="text-rdb-orange">{formatNumber(stats.closedBattles)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">submissions</div><div className="text-rdb-orange">{formatNumber(stats.totalSubmissions)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">votes</div><div className="text-rdb-orange">{formatNumber(stats.totalVotes)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">players</div><div className="text-rdb-orange">{formatNumber(users.length)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">banned</div><div className="text-rdb-orange">{formatNumber(bannedUsers.length)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">win rate</div><div className="text-rdb-orange">{winRate}%</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">peak online</div><div className="text-rdb-orange">{formatNumber(siteStats.find((s) => s.metric === 'peak_online')?.value || 0)}</div></div>
            <div><div className="text-xs uppercase text-rdb-muted">page visits</div><div className="text-rdb-orange">{formatNumber(siteStats.find((s) => s.metric === 'page_visits')?.value || 0)}</div></div>
          </div>
        </div>

        <div className="rdb-panel p-3">
          <h2 className="rdb-section-title">BATTLE TIMELINE (7D)</h2>
          <div className="mt-3 flex items-end gap-2" style={{ height: 120 }}>
            {dailyBattles.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="font-mono text-xs text-rdb-muted">{d.count}</div>
                <div
                  className="w-full rounded-t bg-rdb-orange transition-all"
                  style={{ height: `${(d.count / maxDaily) * 80}px`, minHeight: d.count ? 4 : 0, opacity: 0.7 + (d.count / maxDaily) * 0.3 }}
                />
                <div className="font-mono text-[9px] uppercase text-rdb-muted">{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rdb-panel p-3">
          <h2 className="rdb-section-title">TIER DISTRIBUTION</h2>
          <div className="mt-3 space-y-2">
            {tierDistribution.map((t) => (
              <div key={t.tier} className="flex items-center gap-3">
                <div className="w-20 font-mono text-xs uppercase" style={{ color: TIER_COLORS[t.tier] || '#fff' }}>{t.tier}</div>
                <div className="flex-1 rounded bg-rdb-bg">
                  <div
                    className="rounded px-1 py-1.5 text-right font-mono text-xs text-black transition-all"
                    style={{ width: `${(t.count / maxTier) * 100}%`, minWidth: t.count ? 20 : 0, backgroundColor: TIER_COLORS[t.tier] || '#888' }}
                  >
                    {t.count}
                  </div>
                </div>
              </div>
            ))}
            {!tierDistribution.length && <Empty label="NO PLAYERS." />}
          </div>
        </div>

        <div className="rdb-panel p-3">
          <h2 className="rdb-section-title">MODE DISTRIBUTION</h2>
          <div className="mt-3 space-y-2">
            {modeDistribution.map((m) => (
              <div key={m.mode} className="flex items-center gap-3">
                <div className="w-24 font-mono text-xs uppercase text-rdb-muted">{m.mode}</div>
                <div className="flex-1 rounded bg-rdb-bg">
                  <div
                    className="rounded bg-rdb-orange px-1 py-1.5 text-right font-mono text-xs text-black transition-all"
                    style={{ width: `${(m.count / maxMode) * 100}%`, minWidth: m.count ? 20 : 0 }}
                  >
                    {m.count}
                  </div>
                </div>
              </div>
            ))}
            {!modeDistribution.length && <Empty label="NO BATTLES." />}
          </div>
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">ELO RANGE DISTRIBUTION</h2>
        <div className="mt-3 space-y-2">
          {eloBuckets.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <div className="w-24 font-mono text-xs uppercase text-rdb-muted">{b.label}</div>
              <div className="flex-1 rounded bg-rdb-bg">
                <div
                  className="rounded bg-purple-500 px-1 py-1.5 text-right font-mono text-xs text-black transition-all"
                  style={{ width: `${(b.count / maxEloBucket) * 100}%`, minWidth: b.count ? 20 : 0 }}
                >
                  {b.count}
                </div>
              </div>
            </div>
          ))}
          {!eloBuckets.some((b) => b.count) && <Empty label="NO PLAYERS." />}
        </div>
      </section>

      <section className="rdb-panel p-3">
        <h2 className="rdb-section-title">TOP 10 ELO PLAYERS</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="rdb-table min-w-[500px]">
            <thead>
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">username</th>
                <th className="text-left">elo</th>
                <th className="text-left">tier</th>
                <th className="text-left">wins</th>
                <th className="text-left">created</th>
              </tr>
            </thead>
            <tbody>
              {topElo.map((user, i) => (
                <tr key={user.id} className="h-8 border-t border-rdb-border">
                  <td className="font-mono text-xs text-rdb-muted">{i + 1}</td>
                  <td><Link className="font-mono text-sm hover:text-rdb-orange" to={`/profile/${user.username}`}>{user.username}</Link></td>
                  <td className="font-mono text-sm text-rdb-orange">{formatNumber(user.elo || 0)}</td>
                  <td className="font-mono text-xs uppercase" style={{ color: TIER_COLORS[user.rank_tier] || '#fff' }}>{user.rank_tier || 'bronze'}</td>
                  <td className="font-mono text-sm">{user.wins || 0}</td>
                  <td className="font-mono text-xs text-rdb-muted">{new Date(user.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {!topElo.length && <tr><td className="h-9 text-rdb-muted">NO PLAYERS.</td></tr>}
            </tbody>
          </table>
        </div>
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
        <h2 className="rdb-section-title">RECENT BATTLES (LAST 10)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="rdb-table min-w-[800px]">
            <thead>
              <tr>
                <th className="text-left">id</th>
                <th className="text-left">mode</th>
                <th className="text-left">status</th>
                <th className="text-left">prompt</th>
                <th className="text-left">subs</th>
                <th className="text-left">votes</th>
                <th className="text-left">created</th>
                <th className="text-left">action</th>
              </tr>
            </thead>
            <tbody>
              {recentBattles.map((b) => (
                <tr key={b.id} className="h-8 border-t border-rdb-border">
                  <td className="max-w-[80px] truncate font-mono text-xs text-rdb-muted">{b.id}</td>
                  <td className="font-mono text-xs uppercase">{b.mode || 'quick'}</td>
                  <td><span className={`font-mono text-xs uppercase ${b.status === 'closed' ? 'text-rdb-muted' : 'text-rdb-orange'}`}>{b.status}</span></td>
                  <td className="max-w-[200px] truncate font-mono text-xs text-rdb-muted">{b.prompt?.slice(0, 40)}</td>
                  <td className="font-mono text-xs">{b.submissions?.[0]?.count || 0}</td>
                  <td className="font-mono text-xs">{b.votes?.[0]?.count || 0}</td>
                  <td className="whitespace-nowrap font-mono text-xs text-rdb-muted">{new Date(b.created_at).toLocaleString()}</td>
                  <td>
                    {['active', 'voting'].includes(b.status) && (
                      <button className="rdb-button text-xs" type="button" onClick={() => closeBattle(b)}>CLOSE</button>
                    )}
                  </td>
                </tr>
              ))}
              {!recentBattles.length && <tr><td className="h-9 text-rdb-muted">NO BATTLES.</td></tr>}
            </tbody>
          </table>
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
