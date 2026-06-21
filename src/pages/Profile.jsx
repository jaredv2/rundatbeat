import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Calendar, Settings, Shirt, Trophy } from 'lucide-react';
import AddFriendButton from '../components/social/AddFriendButton';
import ReportButton from '../components/social/ReportButton';
import RankBadge from '../components/ui/RankBadge';
import TokenBadge from '../components/tokens/TokenBadge';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji, getProfileAccentStyle, getProfileBannerStyle } from '../lib/display';
import { xpForLevel } from '../lib/xp';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

export default function Profile() {
  const { userId } = useParams();
  const { profile: viewer, refreshProfile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const customBadge = useMemo(() => (
    profile?.custom_badge
    || profile?.user_shop_purchases?.find((p) => ['profile_badge', 'custom_badge'].includes(p.shop_items?.item_type))?.metadata?.value
    || profile?.user_shop_purchases?.find((p) => ['profile_badge', 'custom_badge'].includes(p.shop_items?.item_type))?.metadata?.badge_text
  ), [profile]);

  useEffect(() => {
    async function load() {
      const { data: user } = await supabase.from('profiles').select('*, user_shop_purchases(metadata, shop_items(item_type))').eq('id', userId).maybeSingle();
      setProfile(user);
      setDescription(user?.description || '');
    }
    load();
  }, [userId]);

  if (!profile) return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;

  const isOwnProfile = viewer?.id === profile.id;
  const winRate = profile.battles_entered ? Math.round((profile.wins / profile.battles_entered) * 100) : 0;
  const rankedWins = profile.ranked_wins || 0;
  const rankedLosses = profile.ranked_losses || 0;
  const rankedPlayed = rankedWins + rankedLosses;
  const rankedRate = rankedPlayed ? Math.round((rankedWins / rankedPlayed) * 100) : 0;
  const joined = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'UNKNOWN';

  const level = profile.level || 1;
  const xp = profile.xp || 0;
  const xpCurrent = xpForLevel(level);
  const xpNext = xpForLevel(level + 1);
  const levelProgress = xpNext > xpCurrent ? ((xp - xpCurrent) / (xpNext - xpCurrent)) : 1;

  async function saveDescription() {
    try {
      const { error } = await supabase.from('profiles').update({ description }).eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, description });
      setEditing(false);
      await refreshProfile();
      addToast('DESCRIPTION UPDATED');
    } catch (error) {
      addToast(error.message || 'DESCRIPTION UPDATE FAILED', 'error');
    }
  }

  return (
    <main
      className={`profile-theme theme-${profile.active_theme || 'default'} profile-page-shell`}
      style={getProfileAccentStyle(profile)}
    >
      <div className="relative z-10 mx-auto max-w-[760px] space-y-3">
        {/* ── Nav ── */}
        <div className="flex items-center justify-between">
          <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/"><ArrowLeft size={14} />MAIN MENU</Link>
          <div className="flex gap-2">
            {isOwnProfile && <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/settings"><Settings size={14} />SETTINGS</Link>}
            <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/cosmetics"><Shirt size={14} />COSMETICS</Link>
          </div>
        </div>

        {/* ── Profile card ── */}
        <div className="rdb-panel overflow-hidden" style={{ borderColor: 'var(--profile-accent)' }}>
          {/* Banner */}
          <div className="relative h-[180px] w-full" style={getProfileBannerStyle(profile)}>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/50" />
          </div>

          {/* Avatar overlapping banner */}
          <div className="relative px-5">
            <div className="-mt-10 mb-1 flex items-end gap-4">
              {profile.avatar_url
                ? <img loading="lazy" className="h-[76px] w-[76px] flex-shrink-0 rounded-xl border-[3px] border-[var(--color-rdb-surface)] object-cover shadow-md" src={profile.avatar_url} alt="" />
                : <div className="grid h-[76px] w-[76px] flex-shrink-0 place-items-center rounded-xl border-[3px] border-[var(--color-rdb-surface)] bg-rdb-surface text-2xl">🎧</div>
              }
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="flex items-center gap-2">
                  <h1 className={`truncate font-mono text-2xl font-bold uppercase leading-none ${getNameCosmeticClassName(profile)}`} style={getNameGradientStyle(profile)}>
                    {profile.nameplate_icon && <span className="mr-1.5 text-xl text-rdb-orange">{getNameplateEmoji(profile.nameplate_icon)}</span>}
                    {profile.username}
                  </h1>
                  <div className="flex-shrink-0"><RankBadge tier={profile.rank_tier} /></div>
                </div>
                <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase text-rdb-muted">
                  <button className="hover:text-rdb-orange transition-colors" type="button" onClick={() => { playUiSound('click'); navigator.clipboard.writeText(profile.id); addToast('USER ID COPIED'); }}>{profile.id}</button>
                  <span className="flex items-center gap-1"><Calendar size={10} />{joined}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stats + Badges row */}
          <div className="px-5 pb-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] uppercase text-rdb-text">
              <span className="inline-flex items-center gap-1"><Trophy size={11} className="text-rdb-orange" />LVL {level}</span>
              <span className="h-3 w-px bg-rdb-border" />
              <span>{xp - xpCurrent}/{xpNext - xpCurrent} XP</span>
              <span className="h-3 w-px bg-rdb-border" />
              <span>TIER {profile.rank_tier || 'bronze'}</span>
              <span className="h-3 w-px bg-rdb-border" />
              <span><TokenBadge amount={profile.tokens} /></span>
              {customBadge && <><span className="h-3 w-px bg-rdb-border" /><span className="inline-flex items-center gap-1"><BadgeCheck size={11} className="text-rdb-orange" />{customBadge}</span></>}
              <div className="ml-auto flex gap-1.5"><AddFriendButton targetUserId={profile.id} /><ReportButton reportedUserId={profile.id} /></div>
            </div>
            {/* XP bar */}
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-rdb-border">
              <div className="h-full rounded-full bg-rdb-orange transition-all" style={{ width: `${Math.min(100, Math.round(levelProgress * 100))}%` }} />
            </div>
          </div>
        </div>

        {/* ── Stats card ── */}
        <div className="rdb-panel p-4" style={{ borderColor: 'var(--profile-accent)' }}>
          <div className="grid grid-cols-4 gap-3 text-center">
            <StatBlock value={profile.elo || 1000} label="ELO" />
            <StatBlock value={rankedWins} label="WINS" />
            <StatBlock value={rankedLosses} label="LOSSES" />
            <StatBlock value={rankedRate} label="WIN RATE" suffix="%" />
          </div>
        </div>

        {/* ── About card ── */}
        <div className="rdb-panel p-4" style={{ borderColor: 'var(--profile-accent)' }}>
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase text-rdb-orange">ABOUT</h2>
            {isOwnProfile && <button className="font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-orange transition-colors" type="button" onClick={() => editing ? saveDescription() : setEditing(true)}>{editing ? 'SAVE' : 'EDIT'}</button>}
          </div>
          {editing ? (
            <textarea className="rdb-input mt-2 min-h-16 text-[12px]" maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
          ) : (
            <p className="mt-2 font-mono text-[12px] leading-relaxed text-rdb-text">{profile.description || (isOwnProfile ? 'No description yet.' : 'No description yet.')}</p>
          )}
        </div>
      </div>
    </main>
  );
}

function StatBlock({ value, label, suffix = '' }) {
  const displayValue = typeof value === 'number' ? formatNumber(value) : value;
  return (
    <div>
      <div className="text-2xl font-bold text-rdb-text">{displayValue}{suffix}</div>
      <div className="text-[10px] uppercase text-rdb-muted">{label}</div>
    </div>
  );
}