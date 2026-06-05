import { useState } from 'react';
import { Check, ShoppingBag } from 'lucide-react';
import { getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji, slugCosmeticName } from '../../lib/display';
import ConfirmModal from '../ui/ConfirmModal';

const ICONS = ['KEYS', 'FIRE', 'VOLT', 'ALIEN', 'TAPE', 'CUP', 'SKULL', 'TARGET'];
const THEMES = [
  { name: 'Crimson Grid', theme: 'crimson', color: '#ff4d3d' },
  { name: 'Neon Console', theme: 'console', color: '#34d399' },
  { name: 'Midnight Tape', theme: 'midnight', color: '#7c3aed' },
  { name: 'Chrome Stage', theme: 'chrome', color: '#f0f0f0' },
  { name: 'Arcade Violet', theme: 'violet', color: '#a855f7' },
  { name: 'Producer Gold', theme: 'gold', color: '#ffd700' },
  { name: 'RDB Orange', theme: 'default', color: '#FF8C00' },
];

function themeForItem(item) {
  if (!item) return THEMES[0];
  const itemName = item.name.toLowerCase();
  return THEMES.find((nextTheme) => itemName.includes(nextTheme.name.toLowerCase().split(' ')[0])) || THEMES[0];
}

export default function PurchaseModal({ item, open, closedBattles = [], onCancel, onConfirm }) {
  const [value, setValue] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);
  const [theme, setTheme] = useState(THEMES[0]);
  const [battleId, setBattleId] = useState('');
  if (!item) return null;
  const label = item.item_type === 'username_change' ? 'NEW USERNAME' : 'BADGE TEXT MAX 12';

  function metadata() {
    if (['custom_badge', 'profile_badge'].includes(item.item_type)) return { badge_text: value.slice(0, 12) };
    if (item.item_type === 'nameplate_icon') return { icon };
    if (item.item_type === 'username_change') return { value };
    if (item.item_type === 'profile_accent') {
      const itemTheme = themeForItem(item);
      return { accent_color: itemTheme.color, theme: itemTheme.theme };
    }
    if (item.item_type === 'name_effect') return { effect: slugCosmeticName(item.name) };
    if (item.item_type === 'name_color') return { color: slugCosmeticName(item.name) };
    if (item.item_type === 'replay_access') return { battle_id: battleId };
    return {};
  }

  const previewProfile = {
    username: 'RUNDATBEAT',
    active_name_effect: item.item_type === 'name_effect' ? slugCosmeticName(item.name) : 'wave',
    active_name_color: item.item_type === 'name_color' ? slugCosmeticName(item.name) : 'ember',
    active_theme: 'default',
  };

  return (
    <ConfirmModal open={open} title="CONFIRM PURCHASE" onCancel={onCancel} onConfirm={() => onConfirm(metadata())} confirmLabel={<><Check size={14} />CONFIRM</>}>
      <p className="font-mono uppercase"><ShoppingBag className="mr-1 inline-block align-[-2px]" size={14} />SPEND {item.cost_tokens} RDB ON {item.name}?</p>
      {['custom_badge', 'profile_badge', 'username_change'].includes(item.item_type) && <input className="rdb-input mt-4" maxLength={['custom_badge', 'profile_badge'].includes(item.item_type) ? 12 : 20} placeholder={label} value={value} onChange={(e) => setValue(e.target.value)} />}
      {item.item_type === 'nameplate_icon' && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {ICONS.map((nextIcon) => <button key={nextIcon} className={`border p-2 font-mono text-[11px] ${icon === nextIcon ? 'border-rdb-orange text-rdb-orange' : 'border-rdb-border text-rdb-muted'}`} type="button" onClick={() => setIcon(nextIcon)}>{getNameplateEmoji(nextIcon)} {nextIcon}</button>)}
        </div>
      )}
      {['name_effect', 'name_color'].includes(item.item_type) && (
        <div className="cosmetic-preview mt-4 grid place-items-center p-4 text-center">
          <div className={`font-mono text-3xl font-bold uppercase ${getNameCosmeticClassName(previewProfile)}`} style={getNameGradientStyle(previewProfile)}>
            {previewProfile.username}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase text-rdb-muted">Animated preview ✨</div>
        </div>
      )}
      {item.item_type === 'profile_accent' && (
        <div className="mt-4 grid gap-2">
          <div className="flex items-center justify-between border border-rdb-orange p-2 font-mono text-[11px] uppercase text-rdb-orange">
            <span>{themeForItem(item).name}</span>
            <span className="h-4 w-8 border border-rdb-border" style={{ backgroundColor: themeForItem(item).color }} />
          </div>
        </div>
      )}
      {item.item_type === 'replay_access' && (
        <select className="rdb-input mt-4" value={battleId} onChange={(event) => setBattleId(event.target.value)}>
          <option value="">SELECT CLOSED BATTLE</option>
          {closedBattles.map((battle) => <option key={battle.id} value={battle.id}>{battle.title}</option>)}
        </select>
      )}
    </ConfirmModal>
  );
}
