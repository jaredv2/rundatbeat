import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { requestNotificationPermission, isNotificationPermissionGranted } from '../../lib/notifications';
import { playUiSound } from '../../lib/sfx';

const TYPE_ICONS = {
  battle_won: '🏆',
  battle_lost: '💀',
  battle_invite: '⚔️',
  friend_online: '🟢',
  challenge: '🥊',
  dm: '💬',
  system: '📢',
};

const TYPE_STYLES = {
  battle_won: 'border-green-600 text-green-400',
  battle_lost: 'border-rdb-red text-red-400',
  battle_invite: 'border-rdb-orange text-rdb-orange',
  friend_online: 'border-green-600 text-green-400',
  challenge: 'border-rdb-orange text-rdb-orange',
  dm: 'border-blue-600 text-blue-400',
  system: 'border-rdb-border text-rdb-muted',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'NOW';
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  const days = Math.floor(hrs / 24);
  return `${days}D AGO`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [promptPerm, setPromptPerm] = useState(false);
  const { profile } = useAuthStore();
  const { notifications, unreadCount, markRead, markAllRead } = useNotificationStore();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!isNotificationPermissionGranted() && profile) {
      setPromptPerm(true);
    }
  }, [profile?.id]);

  function handleBellClick() {
    playUiSound('click');
    setOpen(!open);
  }

  async function handleEnableNotifications() {
    playUiSound('click');
    const granted = await requestNotificationPermission();
    setPromptPerm(false);
    if (!granted) {
      useUiStore.getState().addToast('NOTIFICATIONS BLOCKED BY BROWSER', 'error');
    }
  }

  function handleClick(notif) {
    playUiSound('click');
    if (!notif.read_at) markRead(notif.id);
    if (notif.link) {
      navigate(notif.link);
      setOpen(false);
    }
  }

  if (!profile) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className="rdb-button relative"
        type="button"
        onClick={handleBellClick}
        title="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rdb-orange px-1 font-mono text-[9px] font-bold text-black">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-80 max-h-[70vh] overflow-hidden rounded border border-rdb-border bg-rdb-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-rdb-border px-3 py-2">
            <h3 className="font-mono text-[11px] uppercase text-rdb-text">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="font-mono text-[9px] uppercase text-rdb-orange hover:text-orange-300"
                  type="button"
                  onClick={() => { playUiSound('click'); markAllRead(); }}
                >
                  MARK ALL READ
                </button>
              )}
            </div>
          </div>

          {promptPerm && (
            <div className="border-b border-rdb-border px-3 py-2">
              <p className="font-mono text-[10px] uppercase text-rdb-muted mb-2">
                Enable browser notifications for battle alerts?
              </p>
              <div className="flex gap-2">
                <button
                  className="rdb-button rdb-button-primary text-[10px]"
                  type="button"
                  onClick={handleEnableNotifications}
                >
                  ENABLE
                </button>
                <button
                  className="rdb-button text-[10px]"
                  type="button"
                  onClick={() => setPromptPerm(false)}
                >
                  LATER
                </button>
              </div>
            </div>
          )}

          <div className="overflow-y-auto max-h-[55vh]">
            {notifications.length === 0 ? (
              <div className="p-4 text-center font-mono text-[11px] uppercase text-rdb-muted">
                No notifications yet.
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  className={`w-full text-left px-3 py-2.5 border-b border-rdb-border hover:bg-rdb-surface transition-colors ${
                    !notif.read_at ? 'bg-rdb-surface/50' : ''
                  }`}
                  type="button"
                  onClick={() => handleClick(notif)}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-sm flex-shrink-0">
                      {TYPE_ICONS[notif.type] || '📢'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[11px] uppercase font-bold ${
                          TYPE_STYLES[notif.type] || 'text-rdb-text'
                        }`}>
                          {notif.title}
                        </span>
                        {!notif.read_at && (
                          <span className="h-1.5 w-1.5 rounded-full bg-rdb-orange flex-shrink-0" />
                        )}
                      </div>
                      {notif.body && (
                        <p className="mt-0.5 font-mono text-[10px] uppercase text-rdb-muted line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                      <span className="mt-0.5 block font-mono text-[9px] uppercase text-rdb-muted">
                        {timeAgo(notif.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
