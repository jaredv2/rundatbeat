import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchDiscordProfile, buildDiscordPatch } from '../lib/discord';
import { validateUsername } from '../lib/validators';
import { useAuthStore } from '../store/authStore';

export default function Setup() {
  const { user, profile, setProfile } = useAuthStore();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [avail, setAvail] = useState(null); // null = unknown, true = available, false = taken
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (profile?.username) navigate('/');
  }, [profile, navigate]);

  const isDiscordUser = Boolean(user?.app_metadata?.provider === 'discord' || user?.app_metadata?.providers?.includes('discord'));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAvail(null);
    const trimmed = username.trim();
    if (!trimmed || !validateUsername(trimmed)) {
      setChecking(false);
      return;
    }
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id').eq('username', trimmed).maybeSingle();
      setAvail(!data);
      setChecking(false);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [username]);

  const trimmed = username.trim();
  const isValid = validateUsername(trimmed);
  const showStatus = trimmed.length >= 3 && isValid;

  async function createProfile(event) {
    event.preventDefault();
    if (!isValid) {
      setError('USERNAME MUST BE 3-20 CHARS: LETTERS, NUMBERS, UNDERSCORES');
      return;
    }
    if (avail === false) {
      setError('USERNAME TAKEN');
      return;
    }
    if (avail === null || checking) {
      setError('CHECKING USERNAME...');
      return;
    }
    setError('');
    const meta = user.user_metadata || {};

    let discordPatch = {};
    if (isDiscordUser) {
      const discord = await fetchDiscordProfile();
      discordPatch = buildDiscordPatch(user.id, discord) || {};
    }

    const row = {
      id: user.id,
      username: trimmed,
      ...discordPatch,
      avatar_url: discordPatch.avatar_url || meta.avatar_url || meta.picture || null,
      discord_username: isDiscordUser ? (discordPatch.discord_username || meta.full_name || meta.name || meta.preferred_username) : null,
    };
    const { data, error: insertError } = await supabase.from('profiles').insert(row).select('*').single();
    if (insertError) setError(insertError.message);
    else {
      setProfile(data);
      navigate('/');
    }
  }

  return (
    <main className="grid min-h-[70vh] place-items-center p-4">
      <form className="rdb-panel w-full max-w-md p-6" onSubmit={createProfile}>
        <h1 className="font-mono text-3xl text-rdb-orange">SETUP USERNAME</h1>
        {error && <div className="mt-4 border border-rdb-red p-3 font-mono text-rdb-red">{error}</div>}
        <div className="relative mt-5">
          <input
            className="rdb-input w-full pr-10"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
            placeholder="USERNAME"
            autoFocus
          />
          {showStatus && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {checking ? (
                <Loader2 size={16} className="animate-spin text-rdb-muted" />
              ) : avail ? (
                <Check size={16} className="text-green-400" />
              ) : (
                <X size={16} className="text-rdb-red" />
              )}
            </span>
          )}
        </div>
        {showStatus && !checking && (
          <p className={`mt-2 font-mono text-[11px] uppercase ${avail ? 'text-green-400' : 'text-rdb-red'}`}>
            {avail ? 'USERNAME AVAILABLE' : 'USERNAME TAKEN'}
          </p>
        )}
        <button
          className="rdb-button rdb-button-primary mt-5 w-full"
          disabled={showStatus && (!avail || checking)}
        >
          CONFIRM
        </button>
      </form>
    </main>
  );
}
