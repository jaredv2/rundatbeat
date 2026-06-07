import { CheckCircle2, Palette, ShoppingCart, Sparkles, Tag } from 'lucide-react';
import { getNameCosmeticClassName, getNameGradientStyle, slugCosmeticName } from '../../lib/display';
import { playUiSound } from '../../lib/sfx';
import TokenBadge from '../tokens/TokenBadge';

export default function ShopItemCard({ item, balance, owned, onBuy }) {
  const canBuy = balance >= item.cost_tokens;
  const previewProfile = {
    username: item.item_type === 'name_color' ? 'COLOR' : 'EFFECT',
    active_name_color: item.item_type === 'name_color' ? slugCosmeticName(item.name) : 'ember',
    active_name_effect: item.item_type === 'name_effect' ? slugCosmeticName(item.name) : 'wave',
  };
  const Icon = item.item_type === 'name_effect' ? Sparkles : item.item_type === 'profile_accent' || item.item_type === 'name_color' ? Palette : Tag;
  return (
    <article className="rdb-panel flex min-h-[168px] flex-col p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-mono text-xs uppercase text-rdb-text">{item.name}</h3>
        <Icon className="text-rdb-orange" size={16} />
      </div>
      {['name_effect', 'name_color'].includes(item.item_type) && (
        <div className="cosmetic-preview mt-3 grid place-items-center px-3 py-2">
          <span className={`font-mono text-xl font-bold uppercase ${getNameCosmeticClassName(previewProfile)}`} style={getNameGradientStyle(previewProfile)}>
            {previewProfile.username}
          </span>
        </div>
      )}
      <p className="mt-2 flex-1 text-[11px] text-rdb-muted">{item.description}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <TokenBadge amount={item.cost_tokens} />
        {owned ? <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase text-rdb-muted"><CheckCircle2 size={13} />OWNED</span> : <button className="rdb-button border-rdb-orange text-rdb-orange disabled:border-rdb-border disabled:text-rdb-muted" disabled={!canBuy} onClick={() => { playUiSound('click'); onBuy(item); }}><ShoppingCart size={14} />BUY</button>}
      </div>
      {!owned && !canBuy && <div className="mt-2 font-mono text-[10px] uppercase text-rdb-red">NOT ENOUGH RDB</div>}
    </article>
  );
}
