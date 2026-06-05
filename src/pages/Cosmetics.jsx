import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Check, Palette, Shirt, Sparkles } from 'lucide-react';
import TokenBadge from '../components/tokens/TokenBadge';
import {
  NAME_COLOR_STYLES,
  NAME_EFFECT_STYLES,
  THEME_STYLES,
  getNameCosmeticClassName,
  getNameGradientStyle,
  getNameplateEmoji,
  slugCosmeticName,
} from '../lib/display';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Cosmetics() {
  const { user, profile, refreshProfile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [purchases, setPurchases] = useState([]);
  const [reviewRows, setReviewRows] = useState([]);
  const [equipped, setEquipped] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setEquipped({
      active_theme: profile.active_theme || 'default',
      accent_color: profile.accent_color || THEME_STYLES[profile.active_theme || 'default']?.accent || THEME_STYLES.default.accent,
      active_name_color: profile.active_name_color || 'theme',
      active_name_effect: profile.active_name_effect || 'none',
      custom_badge: profile.custom_badge || '',
      nameplate_icon: profile.nameplate_icon || '',
    });
  }, [profile]);

  useEffect(() => {
    async function load() {
      if (!user || !supabase) return;
      const [purchaseRows, queueRows] = await Promise.all([
        supabase.from('user_shop_purchases').select('*, shop_items(name, item_type)').eq('user_id', user.id).order('purchased_at', { ascending: false }),
        supabase.from('shop_review_queue').select('*').eq('user_id', user.id).eq('status', 'approved').order('reviewed_at', { ascending: false }),
      ]);
      setPurchases(purchaseRows.data || []);
      setReviewRows(queueRows.data || []);
    }
    load();
  }, [user]);

  const themeOptions = useMemo(() => {
    const options = [{ label: 'RDB Orange', theme: 'default', accent: THEME_STYLES.default.accent }];
    purchases.filter((row) => row.shop_items?.item_type === 'profile_accent').forEach((row) => {
      const theme = row.metadata?.theme || slugCosmeticName(row.shop_items?.name);
      const accent = row.metadata?.accent_color || THEME_STYLES[theme]?.accent || THEME_STYLES.default.accent;
      options.push({ label: row.shop_items?.name || theme, theme, accent });
    });
    return uniqueBy(options, 'theme');
  }, [purchases]);

  const effectOptions = useMemo(() => uniqueBy([
    { label: NAME_EFFECT_STYLES.none.label, value: 'none' },
    ...purchases.filter((row) => row.shop_items?.item_type === 'name_effect').map((row) => ({
      label: row.shop_items?.name || NAME_EFFECT_STYLES[slugCosmeticName(row.shop_items?.name)]?.label,
      value: row.metadata?.effect || slugCosmeticName(row.shop_items?.name),
    })),
  ], 'value'), [purchases]);

  const colorOptions = useMemo(() => uniqueBy([
    { label: NAME_COLOR_STYLES.theme.label, value: 'theme' },
    ...purchases.filter((row) => row.shop_items?.item_type === 'name_color').map((row) => ({
      label: row.shop_items?.name || NAME_COLOR_STYLES[slugCosmeticName(row.shop_items?.name)]?.label,
      value: row.metadata?.color || slugCosmeticName(row.shop_items?.name),
    })),
  ], 'value'), [purchases]);

  const badgeOptions = useMemo(() => uniqueBy([
    { label: 'No Badge', value: '' },
    ...(profile?.custom_badge ? [{ label: profile.custom_badge, value: profile.custom_badge }] : []),
    ...reviewRows.filter((row) => row.item_type === 'custom_badge').map((row) => ({
      label: row.item_data?.badge_text || row.item_data?.value || 'Custom Badge',
      value: row.item_data?.badge_text || row.item_data?.value || '',
    })),
  ], 'value'), [profile?.custom_badge, reviewRows]);

  const iconOptions = useMemo(() => uniqueBy([
    { label: 'No Icon', value: '' },
    ...(profile?.nameplate_icon ? [{ label: profile.nameplate_icon, value: profile.nameplate_icon }] : []),
    ...reviewRows.filter((row) => row.item_type === 'nameplate_icon').map((row) => ({
      label: row.item_data?.icon || 'ICON',
      value: row.item_data?.icon || '',
    })),
  ], 'value'), [profile?.nameplate_icon, reviewRows]);

  if (!profile) return <Navigate to="/login" replace />;
  if (!equipped) return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;

  const previewProfile = { ...profile, ...equipped };

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update(equipped).eq('id', profile.id);
      if (error) throw error;
      await refreshProfile();
      addToast('COSMETICS EQUIPPED');
    } catch (error) {
      addToast(error.message || 'COSMETICS UPDATE FAILED', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="rdb-container space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-rdb-border pb-3">
        <Link className="rdb-button" to="/shop"><ArrowLeft size={14} />SHOP</Link>
        <h1 className="rdb-section-title mb-0"><Shirt className="mr-1 inline-block align-[-2px]" size={14} />COSMETICS</h1>
        <TokenBadge amount={profile.tokens} />
      </div>

      <section className="rdb-panel p-5 text-center">
        <div className="font-mono text-[11px] uppercase text-rdb-muted">Current Look</div>
        <div className={`mt-3 font-mono text-4xl font-bold uppercase ${getNameCosmeticClassName(previewProfile)}`} style={getNameGradientStyle(previewProfile)}>
          {equipped.nameplate_icon && <span className="mr-2 text-3xl text-rdb-orange">{getNameplateEmoji(equipped.nameplate_icon)}</span>}
          {profile.username}
        </div>
        {equipped.custom_badge && <div className="mt-3 inline-flex items-center gap-1 border border-rdb-border px-2 py-1 font-mono text-xs uppercase text-rdb-muted"><BadgeCheck size={12} />{equipped.custom_badge}</div>}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <OptionPanel icon={<Palette size={15} />} title="Profile Theme">
          {themeOptions.map((option) => (
            <ChoiceButton key={option.theme} active={equipped.active_theme === option.theme} onClick={() => setEquipped((state) => ({ ...state, active_theme: option.theme, accent_color: option.accent }))}>
              <span className="h-4 w-4 border border-rdb-border" style={{ backgroundColor: option.accent }} />
              {option.label}
            </ChoiceButton>
          ))}
        </OptionPanel>

        <OptionPanel icon={<Sparkles size={15} />} title="Name Effect">
          {effectOptions.map((option) => (
            <ChoiceButton key={option.value} active={equipped.active_name_effect === option.value} onClick={() => setEquipped((state) => ({ ...state, active_name_effect: option.value }))}>
              {NAME_EFFECT_STYLES[option.value]?.emoji || '✨'} {option.label}
            </ChoiceButton>
          ))}
        </OptionPanel>

        <OptionPanel icon={<Palette size={15} />} title="Name Color">
          {colorOptions.map((option) => (
            <ChoiceButton key={option.value} active={equipped.active_name_color === option.value} onClick={() => setEquipped((state) => ({ ...state, active_name_color: option.value }))}>
              {NAME_COLOR_STYLES[option.value]?.emoji || '🎨'} {option.label}
            </ChoiceButton>
          ))}
        </OptionPanel>

        <OptionPanel icon={<BadgeCheck size={15} />} title="Badge + Nameplate">
          <select className="rdb-input" value={equipped.custom_badge} onChange={(event) => setEquipped((state) => ({ ...state, custom_badge: event.target.value }))}>
            {badgeOptions.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
          </select>
          <select className="rdb-input mt-2" value={equipped.nameplate_icon} onChange={(event) => setEquipped((state) => ({ ...state, nameplate_icon: event.target.value }))}>
            {iconOptions.map((option) => <option key={option.value || 'none'} value={option.value}>{option.value ? `${getNameplateEmoji(option.value)} ${option.label}` : option.label}</option>)}
          </select>
        </OptionPanel>
      </section>

      <button className="rdb-button rdb-button-primary w-full" disabled={saving} type="button" onClick={save}>
        <Check size={14} />{saving ? 'SAVING...' : 'EQUIP SELECTED'}
      </button>
    </main>
  );
}

function OptionPanel({ icon, title, children }) {
  return (
    <section className="rdb-panel p-4">
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[12px] uppercase text-rdb-orange">{icon}{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function ChoiceButton({ active, onClick, children }) {
  return (
    <button className={`rdb-button justify-start ${active ? 'border-rdb-orange text-rdb-orange' : 'text-rdb-muted'}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
