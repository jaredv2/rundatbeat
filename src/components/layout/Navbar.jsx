import { Link, NavLink } from 'react-router-dom';
import { LogOut, Settings, Shirt, User } from 'lucide-react';
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
      options: { redirectTo: window.location.origin },
    });
  };
  return <button className="rdb-button border-rdb-discord bg-rdb-discord text-white" onClick={login}>CONNECT WITH DISCORD</button>;
}

export default function Navbar() {
  const { profile, logout } = useAuthStore();
  const navClass = ({ isActive }) => `font-mono text-[11px] uppercase hover:text-rdb-orange ${isActive ? 'text-rdb-orange' : 'text-rdb-muted'}`;
  async function signOut() {
    playUiSound('cancel');
    await logout();
  }
  return (
    <header className="sticky top-0 z-30 border-b border-rdb-border bg-rdb-bg/95">
      <nav className="mx-auto flex min-h-[44px] max-w-[1100px] items-center justify-between gap-4 px-3">
        <Link to="/" className="flex items-center gap-2 font-mono text-[13px] font-bold uppercase text-rdb-orange">
          <img src="/logo.png" alt="" className="h-6 w-6" />
          RUNDATBEAT
        </Link>
        <div className="hidden gap-4 md:flex">
          <NavLink className={navClass} to="/">HOME</NavLink>
          {profile && <NavLink className={navClass} to="/leaderboard">LEADERBOARD</NavLink>}
          {profile && <NavLink className={navClass} to="/shop">SHOP</NavLink>}
          {profile && <NavLink className={navClass} to="/cosmetics">COSMETICS</NavLink>}
        </div>
        <div className="flex items-center gap-2">
          {profile ? (
            <>
              <TokenBadge amount={profile.tokens} />
              <span className="text-rdb-muted">|</span>
              <Link className={`font-mono text-[11px] uppercase hover:text-rdb-orange ${getNameCosmeticClassName(profile)}`} style={getNameGradientStyle(profile)} to={`/profile/${profile.username}`}>
                <User className="inline-block align-[-2px]" size={12} /> {profile.username}
              </Link>
              {profile.avatar_url && <img loading="lazy" className="h-6 w-6 rounded border border-rdb-border object-cover" src={profile.avatar_url} alt="" />}
              <Link className="rdb-button hidden sm:inline-flex" to="/cosmetics"><Shirt size={14} />COSMETICS</Link>
              <Link className="rdb-button hidden sm:inline-flex" to="/settings"><Settings size={14} />SETTINGS</Link>
              <button className="rdb-button hidden sm:inline-flex" type="button" onClick={signOut}><LogOut size={14} />LOGOUT</button>
              <NotificationBell />
            </>
          ) : <LoginButton />}
        </div>
      </nav>
    </header>
  );
}
