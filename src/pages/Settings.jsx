import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { uploadAvatar } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Settings() {
  const { user, profile, refreshProfile, logout } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [description, setDescription] = useState(profile?.description || '');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!profile) return <Navigate to="/login" replace />;

  async function saveProfile(event) {
    event.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    try {
      let avatarUrl = profile.avatar_url;
      if (file) {
        avatarUrl = await uploadAvatar({ userId: user.id, file });
      }
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl, description })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setFile(null);
      addToast('SETTINGS SAVED');
    } catch (error) {
      addToast(error.message || 'SETTINGS SAVE FAILED', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    navigate('/landing', { replace: true });
  }

  return (
    <main className="rdb-container-narrow">
      <form className="rdb-panel space-y-5 p-5" onSubmit={saveProfile}>
        <div className="flex items-center justify-between gap-3 border-b border-rdb-border pb-4">
          <div>
            <h1 className="font-mono text-xl uppercase text-rdb-orange">Settings</h1>
            <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">Profile and account controls</p>
          </div>
          <button className="rdb-button" type="button" onClick={signOut}>Logout</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[110px_1fr]">
          {profile.avatar_url ? <img loading="lazy" className="h-24 w-24 rounded-lg border border-rdb-border object-cover" src={profile.avatar_url} alt="" /> : <div className="h-24 w-24 rounded-lg border border-rdb-border bg-rdb-surface" />}
          <div>
            <label className="font-mono text-[11px] uppercase text-rdb-muted" htmlFor="avatar">Profile picture</label>
            <input id="avatar" className="rdb-input mt-2" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <p className="mt-2 font-mono text-[10px] uppercase text-rdb-muted">PNG, JPG, WEBP, or GIF. Max 5MB.</p>
          </div>
        </div>

        <div>
          <label className="font-mono text-[11px] uppercase text-rdb-muted" htmlFor="description">About</label>
          <textarea id="description" className="rdb-input mt-2 min-h-28" maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button className="rdb-button" type="button" onClick={() => navigate(-1)}>Cancel</button>
          <button className="rdb-button rdb-button-primary" disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Settings'}</button>
        </div>
      </form>
    </main>
  );
}
