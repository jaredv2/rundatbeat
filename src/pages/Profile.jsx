import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Calendar, Edit3, Save, Settings, Shirt, Trophy } from 'lucide-react';
import WaveformPlayer from '../components/audio/WaveformPlayer';
import AddFriendButton from '../components/social/AddFriendButton';
import ReportButton from '../components/social/ReportButton';
import RankBadge from '../components/ui/RankBadge';
import TokenBadge from '../components/tokens/TokenBadge';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji, getProfileAccentStyle } from '../lib/display';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

export default function Profile() {
  const { username } = useParams();
  const { profile: viewer, refreshProfile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [profile, setProfile] = useState(null);
  const [submissions, setSubmissions] = useState([]);
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
      if (user) {
        const { data: subs } = await supabase.from('submissions').select('*, battles(title, status, genre)').eq('user_id', user.id).order('submitted_at', { ascending: false });
        setSubmissions(subs || []);
      }
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
      style={{
        ...getProfileAccentStyle(profile),
        '--grid-line-color': `color-mix(in srgb, var(--profile-accent) 18%, transparent)`,
        backgroundImage: [
          `linear-gradient(color-mix(in srgb, var(--profile-accent) 10%, transparent) 1px, transparent 1px)`,
          `linear-gradient(90deg, color-mix(in srgb, var(--profile-accent) 10%, transparent) 1px, transparent 1px)`,
        ].join(', '),
      }}
    >
      <div className="mx-auto flex max-w-[760px] items-center justify-between">
        <Link className="rdb-button" to="/"><ArrowLeft size={14} />MAIN MENU</Link>
        <div className="flex gap-2">
          {isOwnProfile && <Link className="rdb-button" to="/settings"><Settings size={14} />SETTINGS</Link>}
          <Link className="rdb-button" to="/cosmetics"><Shirt size={14} />COSMETICS</Link>
        </div>
      </div>

      <section className="rdb-panel mx-auto max-w-[760px] p-5" style={{ borderColor: 'var(--profile-accent)' }}>
        <div className="grid gap-4 md:grid-cols-[1fr_270px]">
          <div className="bg-rdb-bg/30 p-5">
            <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
              {profile.avatar_url ? <img loading="lazy" className="h-28 w-28 rounded-lg object-cover shadow-[0_0_28px_rgba(255,157,0,0.16)]" src={profile.avatar_url} alt="" /> : <div className="grid h-28 w-28 place-items-center rounded-lg bg-rdb-bg text-4xl">🎧</div>}
              <div className="min-w-0">
                <h1 className={`truncate font-mono text-4xl font-bold uppercase leading-none ${getNameCosmeticClassName(profile)}`} style={getNameGradientStyle(profile)}>
                  {profile.nameplate_icon && <span className="mr-2 text-3xl text-rdb-orange">{getNameplateEmoji(profile.nameplate_icon)}</span>}
                  {profile.username}
                </h1>
                <button className="mt-1 block truncate font-mono text-[10px] uppercase text-rdb-muted hover:text-rdb-orange" type="button" onClick={() => { playUiSound('click'); navigator.clipboard.writeText(profile.id); addToast('USER ID COPIED'); }} title="Click to copy user ID">{profile.id}</button>
                <div className="mt-1 flex items-center justify-center gap-1 font-mono text-[11px] uppercase text-rdb-muted sm:justify-start"><Calendar size={12} />JOINED {joined}</div>
                <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <RankBadge tier={profile.rank_tier} />
                  <span className="inline-flex items-center gap-1 border border-rdb-border px-2 py-1 font-mono text-xs uppercase text-rdb-muted"><Trophy size={12} />{profile.elo || 1000} ELO</span>
                </div>
              </div>
            </div>
          </div>

          <aside className="bg-rdb-bg/20 p-4" style={{ border: '1px solid var(--profile-accent, var(--color-rdb-border))' }}>
            <div className="grid min-h-[140px] place-items-center gap-3 text-center font-mono uppercase">
              <StatBlock value={profile.elo || 1000} label="ELO" />
              <StatBlock value={rankedWins} label="RANKED WINS" />
              <StatBlock value={rankedLosses} label="RANKED LOSSES" />
              <StatBlock value={rankedRate} label="RANKED WIN RATE" suffix="%" />
            </div>
          </aside>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {customBadge && <span className="inline-flex items-center gap-1 px-2 py-1 font-mono text-xs text-rdb-muted" ><BadgeCheck size={12} />{customBadge}</span>}
          <span className="px-2 py-1 font-mono text-xs uppercase text-rdb-muted">TIER {profile.rank_tier || 'bronze'}</span>
          <span className="px-2 py-1 font-mono text-xs uppercase text-rdb-muted" ><TokenBadge amount={profile.tokens} /></span>
          <div className="ml-auto flex gap-2"><AddFriendButton targetUserId={profile.id} /><ReportButton reportedUserId={profile.id} /></div>
        </div>
      </section>

      <section className="rdb-panel mx-auto max-w-[760px] p-5" style={{ borderColor: 'var(--profile-accent)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="rdb-section-title">ABOUT</h2>
          {isOwnProfile && <button className="rdb-button" type="button" onClick={() => editing ? saveDescription() : setEditing(true)}>{editing ? <Save size={14} /> : <Edit3 size={14} />}{editing ? 'SAVE' : 'EDIT'}</button>}
        </div>
        {editing ? (
          <textarea className="rdb-input min-h-24" maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
        ) : (
          <p className="font-mono text-[12px] text-rdb-muted">{profile.description || 'No description yet. Click Edit to add one.'}</p>
        )}
      </section>

      <section className="mx-auto max-w-[860px]">
        <h2 className="rdb-section-title">SUBMISSIONS</h2>
        <div className="mt-2 flex flex-col gap-3">
          {submissions.length === 0 && (
            <p className="border-t border-rdb-border pt-4 font-mono text-[12px] uppercase text-rdb-muted">
              NO SUBMISSIONS YET.
            </p>
          )}
          {submissions.map((submission) => {
            // Debug: log each submission card render
            console.log('[Profile] Rendering submission card:', submission.id, submission.battles?.title);
            const submissionDate = submission.submitted_at
              ? new Date(submission.submitted_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
              : '—';
            const battleMode = (submission.battles?.mode || submission.battles?.genre || 'QUICK').toUpperCase();
            const battleGenre = (submission.battles?.genre || '').toUpperCase();
            return (
              <div
                key={submission.id}
                className="rdb-panel bg-rdb-surface p-4"
                style={{ borderColor: 'var(--profile-accent, var(--color-rdb-border))' }}
              >
                {/* Top row: title + mode tags on left, votes on right */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold uppercase text-rdb-text">
                      {submission.battles?.title || '—'}
                    </span>
                    <span className="border border-rdb-border px-2 py-0.5 font-mono text-[10px] uppercase text-rdb-muted">
                      {battleMode}
                    </span>
                    {battleGenre && battleGenre !== battleMode && (
                      <span className="border border-rdb-border px-2 py-0.5 font-mono text-[10px] uppercase text-rdb-muted">
                        {battleGenre}
                      </span>
                    )}
                  </div>
                  {/* Votes — orange number + label, matching Image 1 */}
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-lg font-bold text-rdb-orange leading-none">
                      {formatNumber(submission.vote_count ?? 0)}
                    </div>
                    <div className="font-mono text-[10px] uppercase text-rdb-muted">VOTES</div>
                  </div>
                </div>

                {/* Middle row: PLAY button + waveform */}
                <div className="flex items-center gap-3">
                  <WaveformPlayer url={submission.audio_url} profile={profile} />
                </div>

                {/* Bottom row: date aligned right */}
                <div className="mt-2 text-right font-mono text-[10px] text-rdb-muted">
                  {submissionDate}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function StatBlock({ value, label, suffix = '' }) {
  const displayValue = typeof value === 'number' ? formatNumber(value) : value;
  return <div><div className="text-3xl text-rdb-text">{displayValue}{suffix}</div><div className="text-[11px] text-rdb-muted">{label}</div></div>;
}