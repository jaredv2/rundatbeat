import { supabase } from './supabase';

let permissionGranted = false;

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') { permissionGranted = true; return true; }
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  permissionGranted = result === 'granted';
  return permissionGranted;
}

export function isNotificationPermissionGranted() {
  if (!('Notification' in window)) return false;
  if (permissionGranted) return true;
  return Notification.permission === 'granted';
}

export function sendBrowserNotification(title, options = {}) {
  if (!isNotificationPermissionGranted()) return null;
  try {
    const notif = new Notification(title, {
      icon: '/logo.png',
      badge: '/logo.png',
      tag: options.tag || 'rundatbeat',
      ...options,
    });
    if (options.onClick) {
      notif.onclick = (e) => {
        e.preventDefault();
        window.focus();
        options.onClick();
        notif.close();
      };
    }
    return notif;
  } catch {
    return null;
  }
}

export async function createNotification({ userId, type, title, body, link, actorId }) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        body: body || null,
        link: link || null,
        actor_id: actorId || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}
