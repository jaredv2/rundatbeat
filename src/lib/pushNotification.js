import { supabase } from './supabase';

/**
 * Push a notification to a user (creates DB row + triggers realtime).
 * Other clients will receive this via the notifications REALTIME subscription.
 */
export async function pushNotification(userId, { type, title, body, link, actorId }) {
  if (!supabase || !userId) return null;
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body: body || null,
      link: link || null,
      actor_id: actorId || null,
    });
    if (error) throw error;
    return true;
  } catch {
    return null;
  }
}

/**
 * Notify multiple users at once.
 */
export async function pushNotificationToMany(userIds, { type, title, body, link, actorId }) {
  if (!supabase || !userIds?.length) return;
  const rows = userIds.map((uid) => ({
    user_id: uid,
    type,
    title,
    body: body || null,
    link: link || null,
    actor_id: actorId || null,
  }));
  try {
    await supabase.from('notifications').insert(rows);
  } catch {
    // best-effort
  }
}
