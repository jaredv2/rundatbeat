import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useNotificationStore } from '../store/notificationStore';
import { sendBrowserNotification, isNotificationPermissionGranted } from '../lib/notifications';
import { playUiSound } from '../lib/sfx';

export function useNotifications() {
  const { profile } = useAuthStore();
  const { addNotification, loadNotifications } = useNotificationStore();
  const navigate = useNavigate();
  const channelRef = useRef(null);

  useEffect(() => {
    if (!profile?.id || !supabase) return;

    loadNotifications(profile.id);

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const notif = payload.new;
          if (!notif) return;
          addNotification(notif);
          playUiSound('notification');
          sendBrowserNotification(notif.title, {
            body: notif.body || '',
            tag: notif.id,
            onClick: notif.link ? () => navigate(notif.link) : undefined,
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const updated = payload.new;
          if (!updated) return;
          const store = useNotificationStore.getState();
          const existing = store.notifications.find((n) => n.id === updated.id);
          if (existing) {
            useNotificationStore.setState({
              notifications: store.notifications.map((n) => n.id === updated.id ? updated : n),
              unreadCount: store.notifications.map((n) => n.id === updated.id ? updated : n).filter((n) => !n.read_at).length,
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const deleted = payload.old;
          if (!deleted) return;
          useNotificationStore.getState().removeNotification(deleted.id);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [profile?.id]);
}
