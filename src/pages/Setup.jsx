import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchDiscordProfile, buildDiscordPatch } from '../lib/discord';
import { validateUsername } from '../lib/validators';
import { useAuthStore } from '../store/authStore';

export default function Setup() {
  const { user, profile, setProfile } = useAuthStore();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (profile?.username) navigate('/');
  }, [profile, navigate]);

  async function createProfile(event) {
    event.preventDefault();
    if (!validateUsername(username)) {
      setError('USERNAME MUST BE 3-20 CHARS: LETTERS, NUMBERS, UNDERSCORES');
      return;
    }
    const { data: exists } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle();
    if (exists) {
      setError('USERNAME TAKEN');
      return;
    }
    const meta = user.user_metadata || {};
    const discord = await fetchDiscordProfile();
    const discordPatch = buildDiscordPatch(user.id, discord) || {};
    const row = {
      id: user.id,
      username,
      ...discordPatch,
      avatar_url: discordPatch.avatar_url || meta.avatar_url || meta.picture,
      discord_username: discordPatch.discord_username || meta.full_name || meta.name || meta.preferred_username,
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
        <input className="rdb-input mt-5" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="USERNAME" />
        <button className="rdb-button rdb-button-primary mt-5 w-full">CONFIRM</button>
      </form>
    </main>
  );
}
