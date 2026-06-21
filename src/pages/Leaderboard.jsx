import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import RankBadge from '../components/ui/RankBadge';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../lib/display';
import { supabase } from '../lib/supabase';
import { playUiSound } from '../lib/sfx';

const PAGE_SIZE = 20;

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];

const SORT_COLUMNS = {
  'Wins':       { allTime: 'wins',           period: k => k === 'wins' ? 'period_wins' : k },
  'Battles':    { allTime: 'battles_entered', period: k => k === 'battles_entered' ? 'period_battles' : k },
  'Win Rate':   { allTime: 'win_rate',        period: k => '_win_rate' },
  'ELO':        { allTime: 'elo',             period: k => '_elo' },
  'Tier':       { allTime: 'rank_tier',       period: k => '_tier' },
};

export default function Leaderboard() {
  const [users, setUsers] = useState([]);
  const [periodStats, setPeriodStats] = useState([]);
  const [filter, setFilter] = useState('ALL TIME');
  const [sort, setSort] = useState({ key: 'Wins', dir: 'desc' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    Promise.all([
      supabase?.from('profiles').select('id, username, avatar_url, elo, rank_tier, wins, battles_entered, points, nameplate_icon, active_name_color, active_name_effect').order('points', { ascending: false }).limit(200),
      supabase?.from('leaderboard_period_stats').select('*'),
    ]).then(([profileRows, statRows]) => {
      setUsers(profileRows?.data || []);
      setPeriodStats(statRows?.data || []);
    });
  }, []);

  useEffect(() => { setPage(1); }, [filter, sort]);

  const sortedUsers = useMemo(() => {
    const period = filter === 'THIS WEEK' ? 'week' : filter === 'THIS MONTH' ? 'month' : null;
    const statsByUser = new Map(periodStats.filter((row) => row.period === period).map((row) => [row.user_id, row]));
    const col = SORT_COLUMNS[sort.key];
    return users.map((user) => {
      const stat = statsByUser.get(user.id);
      return period ? {
        ...user,
        period_wins: stat?.period_wins || 0,
        period_battles: stat?.period_battles || 0,
        period_points: stat?.period_points || 0,
      } : user;
    }).sort((a, b) => {
      let va, vb;
      if (period && col.period) {
        const pk = col.period(sort.key);
        if (pk === '_win_rate') {
          va = a.period_battles ? a.period_wins / a.period_battles : 0;
          vb = b.period_battles ? b.period_wins / b.period_battles : 0;
        } else if (pk === '_elo') {
          va = Number(a.elo || 0);
          vb = Number(b.elo || 0);
        } else if (pk === '_tier') {
          va = TIER_ORDER.indexOf(a.rank_tier) ?? -1;
          vb = TIER_ORDER.indexOf(b.rank_tier) ?? -1;
        } else {
          va = Number(a[pk] || 0);
          vb = Number(b[pk] || 0);
        }
      } else {
        const k = col.allTime;
        if (k === 'win_rate') {
          va = a.battles_entered ? a.wins / a.battles_entered : 0;
          vb = b.battles_entered ? b.wins / b.battles_entered : 0;
        } else if (k === 'rank_tier') {
          va = TIER_ORDER.indexOf(a.rank_tier) ?? -1;
          vb = TIER_ORDER.indexOf(b.rank_tier) ?? -1;
        } else {
          va = Number(a[k] || 0);
          vb = Number(b[k] || 0);
        }
      }
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [filter, periodStats, sort, users]);

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE));
  const visibleUsers = sortedUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const globalOffset = (page - 1) * PAGE_SIZE;

  return (
    <main className="rdb-container">
      <div className="text-center">
        <h1 className="font-mono text-4xl font-bold uppercase text-rdb-text">Leaderboard</h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {['ALL TIME', 'THIS MONTH', 'THIS WEEK'].map((tab) => (
            <button key={tab} className={`rdb-button ${filter === tab ? 'rdb-button-primary' : ''}`} onClick={() => { playUiSound('click'); setFilter(tab); }}>{tab}</button>
          ))}
        </div>
      </div>

      <div className="rdb-panel mt-8 overflow-x-auto p-4">
        <table className="rdb-table min-w-[760px]">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              {['Rank', 'Username', 'Wins', 'Battles', 'Win Rate', 'ELO', 'Tier'].map((h) => {
                const isSortable = SORT_COLUMNS[h];
                const active = sort.key === h;
                return (
                  <th
                    key={h}
                    className={`py-3 text-sm select-none ${isSortable ? 'cursor-pointer hover:text-rdb-orange' : ''} ${active ? 'text-rdb-orange' : ''}`}
                    onClick={isSortable ? () => { playUiSound('click'); setSort(s => ({ key: h, dir: s.key === h && s.dir === 'desc' ? 'asc' : 'desc' })); } : undefined}
                  >
                    {h}
                    {active && <span className="ml-1">{sort.dir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user, index) => {
              const globalRank = globalOffset + index + 1;
              const winRate = user.battles_entered ? Math.round((user.wins / user.battles_entered) * 100) : 0;
              const isTop3 = globalRank <= 3;
              return (
                <tr className="hover:text-rdb-orange" key={user.id}>
                  <td className="py-3.5">
                    <span className={`font-mono text-base font-bold ${globalRank === 1 ? 'text-yellow-400' : globalRank === 2 ? 'text-slate-300' : globalRank === 3 ? 'text-amber-600' : 'text-rdb-muted'}`}>
                      {isTop3 ? ['🥇', '🥈', '🥉'][globalRank - 1] : `#${globalRank}`}
                    </span>
                  </td>
                  <td className="py-3.5">
                    <Link
                      className={`hover:underline ${getNameCosmeticClassName(user)} text-lg`}
                      to={`/profile/${user.id}`}
                      style={getNameGradientStyle(user)}
                    >
                      {user.nameplate_icon && (
                        <span className="mr-1 text-rdb-orange">{getNameplateEmoji(user.nameplate_icon)}</span>
                      )}
                      {user.username}
                    </Link>
                  </td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.wins)}</td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.battles_entered)}</td>
                  <td className="py-3.5 font-mono text-sm">{winRate}%</td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.elo)}</td>
                  <td className="py-3.5"><RankBadge tier={user.rank_tier} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 font-mono text-sm uppercase">
          <button
            className="rdb-button"
            disabled={page === 1}
            onClick={() => { playUiSound('click'); setPage((p) => Math.max(1, p - 1)); }}
          >
            <ChevronLeft size={14} />PREV
          </button>
          <span className="text-rdb-muted">
            PAGE <span className="text-rdb-text">{page}</span> / <span className="text-rdb-text">{totalPages}</span>
          </span>
          <button
            className="rdb-button"
            disabled={page === totalPages}
            onClick={() => { playUiSound('click'); setPage((p) => Math.min(totalPages, p + 1)); }}
          >
            NEXT<ChevronRight size={14} />
          </button>
        </div>
      )}
    </main>
  );
}