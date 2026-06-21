import { supabase } from './supabase';
import { buildDiscordBannerUrl, buildDiscordAvatarUrl } from './display';

export async function fetchDiscordProfile() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.provider_token;
    if (!token) {
      const meta = session?.user?.user_metadata || {};
      if (meta.banner || meta.avatar) {
        return {
          id: meta.sub || meta.provider_id || null,
          username: meta.full_name || meta.name || meta.preferred_username,
          avatar: meta.avatar || null,
          banner: meta.banner || null,
          accent_color: meta.accent_color || null,
        };
      }
      return null;
    }
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function buildDiscordPatch(userId, discord, existingProfile = {}) {
  if (!discord) return null;
  const patch = {};
  const discordId = discord.id || null;
  const avatarHash = discord.avatar || null;
  const bannerHash = discord.banner || null;
  const avatarUrl = buildDiscordAvatarUrl(discordId, avatarHash);
  const bannerUrl = buildDiscordBannerUrl(discordId, bannerHash);
  if (discordId) patch.discord_id = discordId;
  if (avatarUrl) patch.avatar_url = avatarUrl;
  if (bannerUrl) patch.discord_banner = bannerUrl;
  if (discord.username) patch.discord_username = discord.username;
  if (discord.accent_color && !existingProfile.accent_color) {
    patch.accent_color = `#${discord.accent_color.toString(16).padStart(6, '0')}`;
  }
  return patch;
}
