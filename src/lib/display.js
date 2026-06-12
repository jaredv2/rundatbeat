export function formatNumber(value = 0) {
  const number = Number(value || 0);
  const abs = Math.abs(number);
  const units = [
    [1_000_000_000_000, 't'],
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ];
  const match = units.find(([size]) => abs >= size);
  if (!match) return number.toLocaleString();
  const compact = number / match[0];
  const rounded = abs >= match[0] * 100 ? compact.toFixed(0) : compact.toFixed(1);
  return `${rounded.replace(/\.0$/, '')}${match[1]}`;
}

export const THEME_STYLES = {
  default: {
    accent: '#ff8c00',
    nameGradient: 'linear-gradient(90deg, #fff4d8, #ff8c00 55%, #ffd166)',
  },
  crimson: {
    accent: '#ff4d3d',
    nameGradient: 'linear-gradient(90deg, #fff1ee, #ff4d3d 48%, #ffb199)',
  },
  console: {
    accent: '#34d399',
    nameGradient: 'linear-gradient(90deg, #ecfdf5, #34d399 50%, #facc15)',
  },
  midnight: {
    accent: '#8b5cf6',
    nameGradient: 'linear-gradient(90deg, #f5f3ff, #8b5cf6 50%, #38bdf8)',
  },
  chrome: {
    accent: '#d1d5db',
    nameGradient: 'linear-gradient(90deg, #ffffff, #cbd5e1 48%, #94a3b8)',
  },
  violet: {
    accent: '#c084fc',
    nameGradient: 'linear-gradient(90deg, #faf5ff, #c084fc 48%, #f0abfc)',
  },
  gold: {
    accent: '#facc15',
    nameGradient: 'linear-gradient(90deg, #fff7cc, #facc15 45%, #fb923c)',
  },
};

export const NAME_COLOR_STYLES = {
  theme: { label: 'Theme Sync', gradient: null, emoji: '🎛️' },
  ember: { label: 'Ember', gradient: 'linear-gradient(90deg, #fff4d8, #ff8c00 28%, #ff335f 62%, #ffe066)', emoji: '🔥' },
  aurora: { label: 'Aurora', gradient: 'linear-gradient(90deg, #ecfdf5, #34d399 30%, #38bdf8 62%, #f0f9ff)', emoji: '✨' },
  chrome: { label: 'Chrome', gradient: 'linear-gradient(90deg, #ffffff, #cbd5e1 36%, #7dd3fc 62%, #f8fafc)', emoji: '💿' },
  candy: { label: 'Candy', gradient: 'linear-gradient(90deg, #fff1f2, #fb7185 30%, #f0abfc 58%, #facc15)', emoji: '🍬' },
};

export const NAME_EFFECT_STYLES = {
  none: { label: 'No Effect', emoji: '•' },
  pulse: { label: 'Pulse', emoji: '💫' },
  glitch: { label: 'Glitch', emoji: '⚡' },
  wave: { label: 'Wave', emoji: '🌊' },
  neon: { label: 'Neon', emoji: '💡' },
};

export const NAMEPLATE_ICONS = {
  KEYS: '🎹',
  FIRE: '🔥',
  VOLT: '⚡',
  ALIEN: '👽',
  TAPE: '📼',
  CUP: '🏆',
  SKULL: '💀',
  TARGET: '🎯',
};

export const RANK_STYLES = {
  bronze: { color: '#f59e0b', bg: 'rgba(146, 64, 14, 0.18)' },
  silver: { color: '#d1d5db', bg: 'rgba(148, 163, 184, 0.18)' },
  gold: { color: '#facc15', bg: 'rgba(250, 204, 21, 0.16)' },
  platinum: { color: '#67e8f9', bg: 'rgba(6, 182, 212, 0.14)' },
  diamond: { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.16)' },
  elite: { color: '#c084fc', bg: 'rgba(168, 85, 247, 0.16)' },
  champion: { color: '#f472b6', bg: 'rgba(236, 72, 153, 0.16)' },
  goat: { color: '#ff8c00', bg: 'rgba(255, 140, 0, 0.18)' },
};

export function getThemeStyle(profile) {
  return THEME_STYLES[profile?.active_theme] || THEME_STYLES.default;
}

export function getProfileAccentStyle(profile) {
  const theme = getThemeStyle(profile);
  const accent = profile?.accent_color || theme.accent;
  return {
    '--profile-accent': accent,
    '--profile-gradient': theme.nameGradient,
  };
}

export function getNameGradientStyle(profile) {
  const nameColor = NAME_COLOR_STYLES[profile?.active_name_color];
  return {
    backgroundImage: nameColor?.gradient || getThemeStyle(profile).nameGradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  };
}

export function getNameCosmeticClassName(profile) {
  const effect = NAME_EFFECT_STYLES[profile?.active_name_effect] ? profile.active_name_effect : 'none';
  const color = NAME_COLOR_STYLES[profile?.active_name_color] ? profile.active_name_color : 'theme';
  return `name-cosmetic name-effect-${effect} name-color-${color}`;
}

export function getNameplateEmoji(icon) {
  return NAMEPLATE_ICONS[icon] || icon || '';
}

export function slugCosmeticName(name = '') {
  const lowered = name.toLowerCase();
  if (lowered.includes('glitch')) return 'glitch';
  if (lowered.includes('wave')) return 'wave';
  if (lowered.includes('neon')) return 'neon';
  if (lowered.includes('pulse')) return 'pulse';
  if (lowered.includes('ember')) return 'ember';
  if (lowered.includes('aurora')) return 'aurora';
  if (lowered.includes('chrome')) return 'chrome';
  if (lowered.includes('candy')) return 'candy';
  return 'theme';
}
