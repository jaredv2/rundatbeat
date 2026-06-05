import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import RankBadge from '../components/ui/RankBadge';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle } from '../lib/display';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 20;

export default function Leaderboard() {
  const [users, setUsers] = useState([]);
  const [periodStats, setPeriodStats] = useState([]);
  const [filter, setFilter] = useState('ALL TIME');
  const [sortKey, setSortKey] = useState('points');
  const [page, setPage] = useState(1);

  useEffect(() => {
    Promise.all([
      supabase?.from('profiles').select('*').order('points', { ascending: false }),
      supabase?.from('leaderboard_period_stats').select('*'),
    ]).then(([profileRows, statRows]) => {
      setUsers(profileRows?.data || []);
      setPeriodStats(statRows?.data || []);
    });
  }, []);

  // Reset to page 1 when filter/sort changes
  useEffect(() => { setPage(1); }, [filter, sortKey]);

  const sortedUsers = useMemo(() => {
    const period = filter === 'THIS WEEK' ? 'week' : filter === 'THIS MONTH' ? 'month' : null;
    const statsByUser = new Map(periodStats.filter((row) => row.period === period).map((row) => [row.user_id, row]));
    return users.map((user) => {
      const stat = statsByUser.get(user.id);
      return period ? {
        ...user,
        period_points: stat?.period_points || 0,
        period_wins: stat?.period_wins || 0,
        period_battles: stat?.period_battles || 0,
      } : user;
    }).sort((a, b) => {
      const key = period
        ? sortKey === 'wins' ? 'period_wins' : sortKey === 'battles_entered' ? 'period_battles' : 'period_points'
        : sortKey;
      return Number(b[key] || 0) - Number(a[key] || 0);
    });
  }, [filter, periodStats, sortKey, users]);

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE));
  const visibleUsers = sortedUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const globalOffset = (page - 1) * PAGE_SIZE;

  return (
    <main className="rdb-container">
      <div className="text-center">
        <h1 className="font-mono text-4xl font-bold uppercase text-rdb-text">Leaderboard</h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {['ALL TIME', 'THIS MONTH', 'THIS WEEK'].map((tab) => (
            <button key={tab} className={`rdb-button ${filter === tab ? 'rdb-button-primary' : ''}`} onClick={() => setFilter(tab)}>{tab}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {[['points', 'Points'], ['wins', 'Wins'], ['battles_entered', 'Battles'], ['total_tokens_earned', 'Earned']].map(([value, label]) => (
            <button key={value} className={`rdb-button ${sortKey === value ? 'border-rdb-orange text-rdb-orange' : ''}`} onClick={() => setSortKey(value)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="rdb-panel mt-8 overflow-x-auto p-4">
        <table className="rdb-table min-w-[760px]">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '11%' }} />
          </colgroup>
          <thead>
            <tr>
              {['Rank', 'Username', 'Wins', 'Battles', 'Win Rate', 'Points', 'RDB', 'Tier'].map((h) => (
                <th key={h} className="py-3 text-sm">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user, index) => {
              const globalRank = globalOffset + index + 1;
              const winRate = user.battles_entered ? Math.round((user.wins / user.battles_entered) * 100) : 0;
              const points = filter === 'ALL TIME' ? user.points : user.period_points;
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
                      to={`/profile/${user.username}`}
                      style={getNameGradientStyle(user)}
                    >
                      {user.username}
                    </Link>
                  </td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.wins)}</td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.battles_entered)}</td>
                  <td className="py-3.5 font-mono text-sm">{winRate}%</td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(points)}</td>
                  <td className="py-3.5 font-mono text-sm">{formatNumber(user.tokens)}</td>
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={14} />PREV
          </button>
          <span className="text-rdb-muted">
            PAGE <span className="text-rdb-text">{page}</span> / <span className="text-rdb-text">{totalPages}</span>
          </span>
          <button
            className="rdb-button"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            NEXT<ChevronRight size={14} />
          </button>
        </div>
      )}
    </main>
  );
}