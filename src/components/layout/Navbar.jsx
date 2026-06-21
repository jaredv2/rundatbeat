import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LogOut, Menu, Settings, Shirt, User, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { playUiSound } from '../../lib/sfx';
import { getNameCosmeticClassName, getNameGradientStyle } from '../../lib/display';
import TokenBadge from '../tokens/TokenBadge';
import NotificationBell from '../notifications/NotificationBell';

function LoginButton() {
  const login = async () => {
    playUiSound('click');
    await supabase?.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: window.location.origin, scopes: 'identify' },
    });
  };
  return <button className="rdb-button bg-rdb-discord border-rdb-discord text-white" onClick={login}>Connect with Discord</button>;
}

export default function Navbar() {
  const { profile, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navClass = ({ isActive }) =>
    `font-mono text-xs uppercase transition-colors ${isActive ? 'text-rdb-orange' : 'text-rdb-muted hover:text-rdb-text'}`;

  async function signOut() {
    playUiSound('cancel');
    await logout();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-rdb-border bg-rdb-bg">
      <nav className="mx-auto flex min-h-[52px] max-w-[1100px] items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-bold uppercase text-rdb-orange">
          <img src="/logo.png" alt="" className="h-5 w-5" />
          SAMPLE BATTLE
        </Link>

        <div className="hidden gap-6 md:flex">
          <NavLink className={navClass} to="/">Home</NavLink>
          {profile && <NavLink className={navClass} to="/leaderboard">Leaderboard</NavLink>}
          {profile && <NavLink className={navClass} to="/shop">Shop</NavLink>}
          {profile && <NavLink className={navClass} to="/cosmetics">Cosmetics</NavLink>}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {profile ? (
            <>
              <TokenBadge amount={profile.tokens} />
              <span className="text-rdb-border">|</span>
              <Link className={`font-mono text-xs uppercase hover:text-rdb-orange ${getNameCosmeticClassName(profile)}`} style={getNameGradientStyle(profile)} to={`/profile/${profile.id}`}>
                <User className="inline-block align-[-2px]" size={14} /> {profile.username}
              </Link>
              {profile.avatar_url && <img loading="lazy" className="h-6 w-6 rounded border border-rdb-border object-cover" src={profile.avatar_url} alt="" />}
              <Link className="rdb-button" to="/cosmetics"><Shirt size={14} />Cosmetics</Link>
              <Link className="rdb-button" to="/settings"><Settings size={14} />Settings</Link>
              <button className="rdb-button" type="button" onClick={signOut}><LogOut size={14} />Logout</button>
              <NotificationBell />
            </>
          ) : <LoginButton />}
        </div>

        <button className="rdb-icon-button md:hidden" type="button" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {mobileOpen && (
        <div className="border-t border-rdb-border bg-rdb-bg p-4 md:hidden">
          <div className="flex flex-col gap-3">
            <NavLink className={navClass} to="/" onClick={() => setMobileOpen(false)}>Home</NavLink>
            {profile && <NavLink className={navClass} to="/leaderboard" onClick={() => setMobileOpen(false)}>Leaderboard</NavLink>}
            {profile && <NavLink className={navClass} to="/shop" onClick={() => setMobileOpen(false)}>Shop</NavLink>}
            {profile && <NavLink className={navClass} to="/cosmetics" onClick={() => setMobileOpen(false)}>Cosmetics</NavLink>}
          </div>
          <div className="mt-4 border-t border-rdb-border pt-4">
            {profile ? (
              <div className="flex flex-col gap-3">
                <TokenBadge amount={profile.tokens} />
                <Link className="font-mono text-xs uppercase text-rdb-text hover:text-rdb-orange" to={`/profile/${profile.id}`} onClick={() => setMobileOpen(false)}>
                  <User className="inline-block align-[-2px]" size={14} /> {profile.username}
                </Link>
                <div className="flex gap-2">
                  <Link className="rdb-button flex-1 justify-center" to="/settings" onClick={() => setMobileOpen(false)}><Settings size={14} />Settings</Link>
                  <button className="rdb-button flex-1 justify-center" type="button" onClick={() => { signOut(); setMobileOpen(false); }}><LogOut size={14} />Logout</button>
                </div>
              </div>
            ) : <LoginButton />}
          </div>
        </div>
      )}
    </header>
  );
}
