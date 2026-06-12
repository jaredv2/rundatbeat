import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loaded: false,

  setNotifications: (notifications) => {
    const unreadCount = notifications.filter((n) => !n.read_at).length;
    set({ notifications, unreadCount, loaded: true });
  },

  addNotification: (notification) => {
    const { notifications } = get();
    if (notifications.some((n) => n.id === notification.id)) return;
    const updated = [notification, ...notifications].slice(0, 100);
    set({ notifications: updated, unreadCount: updated.filter((n) => !n.read_at).length });
  },

  markRead: async (id) => {
    const { notifications } = get();
    const notif = notifications.find((n) => n.id === id);
    if (!notif || notif.read_at) return;
    const now = new Date().toISOString();
    set({
      notifications: notifications.map((n) => n.id === id ? { ...n, read_at: now } : n),
      unreadCount: Math.max(0, get().unreadCount - 1),
    });
    try {
      await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    } catch {
      // optimistic update already applied
    }
  },

  markAllRead: async () => {
    const { notifications } = get();
    const unread = notifications.filter((n) => !n.read_at);
    if (!unread.length) return;
    const now = new Date().toISOString();
    set({
      notifications: notifications.map((n) => n.read_at ? n : { ...n, read_at: now }),
      unreadCount: 0,
    });
    try {
      await supabase.from('notifications').update({ read_at: now }).in('id', unread.map((n) => n.id));
    } catch {
      // optimistic update already applied
    }
  },

  removeNotification: (id) => {
    const { notifications } = get();
    const removed = notifications.find((n) => n.id === id);
    const updated = notifications.filter((n) => n.id !== id);
    set({
      notifications: updated,
      unreadCount: removed && !removed.read_at ? Math.max(0, get().unreadCount - 1) : get().unreadCount,
    });
  },

  clearAll: () => set({ notifications: [], unreadCount: 0 }),

  loadNotifications: async (userId) => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      const list = data || [];
      set({ notifications: list, unreadCount: list.filter((n) => !n.read_at).length, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
