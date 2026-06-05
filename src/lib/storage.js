import { supabase } from './supabase';

export async function uploadBeat({ battleId, userId, file }) {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `${battleId}/${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('beats').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('beats').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatar({ userId, file }) {
  if (!file) throw new Error('SELECT A PROFILE PICTURE');
  if (!file.type?.startsWith('image/')) throw new Error('PROFILE PICTURE MUST BE AN IMAGE');
  if (file.size > 5 * 1024 * 1024) throw new Error('PROFILE PICTURE MUST BE UNDER 5MB');

  const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${userId}/avatar-${Date.now()}.${extension.replace(/[^a-z0-9]/g, '')}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}
