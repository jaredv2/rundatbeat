import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Calendar, Edit3, Save, Settings, Shirt, Trophy } from 'lucide-react';
import AddFriendButton from '../components/social/AddFriendButton';
import ReportButton from '../components/social/ReportButton';
import RankBadge from '../components/ui/RankBadge';
import TokenBadge from '../components/tokens/TokenBadge';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji, getProfileAccentStyle } from '../lib/display';
import { xpForLevel } from '../lib/xp';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

export default function Profile() {
  const { username } = useParams();
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
      const { data: user } = await supabase.from('profiles').select('*, user_shop_purchases(metadata, shop_items(item_type))').eq('username', username).maybeSingle();
      setProfile(user);
      setDescription(user?.description || '');
    }
    load();
  }, [username]);

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
      className={`profile-theme theme-${profile.active_theme || 'default'} profile-page-shell space-y-5`}
      style={getProfileAccentStyle(profile)}
    >
      <div className="relative z-10 mx-auto flex max-w-[760px] items-center justify-between">
        <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/"><ArrowLeft size={14} />MAIN MENU</Link>
        <div className="flex gap-2">
          {isOwnProfile && <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/settings"><Settings size={14} />SETTINGS</Link>}
          <Link className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} to="/cosmetics"><Shirt size={14} />COSMETICS</Link>
        </div>
      </div>

      <section className="rdb-panel relative z-10 mx-auto max-w-[760px] p-5" style={{ borderColor: 'var(--profile-accent)' }}>
        <div className="grid gap-4 md:grid-cols-[1fr_270px]">
          <div className="p-5" style={{ backgroundColor: 'color-mix(in srgb, var(--profile-accent) 8%, var(--color-rdb-surface))' }}>
            <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
              {profile.avatar_url ? <img loading="lazy" className="h-28 w-28 rounded-lg object-cover shadow-[0_0_28px_rgba(255,157,0,0.16)]" src={profile.avatar_url} alt="" /> : <div className="grid h-28 w-28 place-items-center rounded-lg bg-rdb-surface text-4xl">🎧</div>}
              <div className="min-w-0">
                <h1 className={`truncate font-mono text-4xl font-bold uppercase leading-none ${getNameCosmeticClassName(profile)}`} style={getNameGradientStyle(profile)}>
                  {profile.nameplate_icon && <span className="mr-2 text-3xl text-rdb-orange">{getNameplateEmoji(profile.nameplate_icon)}</span>}
                  {profile.username}
                </h1>
                <button className="mt-1 block truncate font-mono text-[10px] uppercase text-rdb-text hover:text-rdb-orange" type="button" onClick={() => { playUiSound('click'); navigator.clipboard.writeText(profile.id); addToast('USER ID COPIED'); }} title="Click to copy user ID">{profile.id}</button>
                <div className="mt-1 flex items-center justify-center gap-1 font-mono text-[11px] uppercase text-rdb-text sm:justify-start"><Calendar size={12} />JOINED {joined}</div>
                <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <RankBadge tier={profile.rank_tier} />
                  <span className="inline-flex items-center gap-1 border border-rdb-border px-2 py-1 font-mono text-xs uppercase text-rdb-text"><Trophy size={12} />LVL {profile.level || 1}</span>
                </div>
              </div>
            </div>
          </div>

          <aside className="p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--profile-accent) 8%, var(--color-rdb-surface))', border: '1px solid var(--profile-accent, var(--color-rdb-border))' }}>
            <div className="grid min-h-[140px] place-items-center gap-3 text-center font-mono uppercase">
              <StatBlock value={profile.elo || 1000} label="ELO" />
              <StatBlock value={rankedWins} label="RANKED WINS" />
              <StatBlock value={rankedLosses} label="RANKED LOSSES" />
              <StatBlock value={rankedRate} label="RANKED WIN RATE" suffix="%" />
            </div>
          </aside>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {customBadge && <span className="inline-flex items-center gap-1 px-2 py-1 font-mono text-xs text-rdb-text" ><BadgeCheck size={12} />{customBadge}</span>}
          <span className="px-2 py-1 font-mono text-xs uppercase text-rdb-text">TIER {profile.rank_tier || 'bronze'}</span>
          <span className="px-2 py-1 font-mono text-xs uppercase text-rdb-text" ><TokenBadge amount={profile.tokens} /></span>
          <div className="ml-auto flex gap-2"><AddFriendButton targetUserId={profile.id} /><ReportButton reportedUserId={profile.id} /></div>
        </div>
      </section>

      <section className="rdb-panel relative z-10 mx-auto max-w-[760px] p-5" style={{ borderColor: 'var(--profile-accent)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="rdb-section-title">ABOUT</h2>
          {isOwnProfile && <button className="rdb-button" style={{ borderColor: 'var(--profile-accent)', color: 'var(--profile-accent)' }} type="button" onClick={() => editing ? saveDescription() : setEditing(true)}>{editing ? <Save size={14} /> : <Edit3 size={14} />}{editing ? 'SAVE' : 'EDIT'}</button>}
        </div>
        {editing ? (
          <textarea className="rdb-input min-h-24" maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
        ) : (
          <p className="font-mono text-[12px] text-rdb-text">{profile.description || 'No description yet. Click Edit to add one.'}</p>
        )}
      </section>
    </main>
  );
}

function StatBlock({ value, label, suffix = '' }) {
  const displayValue = typeof value === 'number' ? formatNumber(value) : value;
  return <div><div className="text-3xl font-bold text-rdb-text">{displayValue}{suffix}</div><div className="text-[11px] uppercase text-rdb-text">{label}</div></div>;
}