import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Shirt } from 'lucide-react';
import InsufficientTokensModal from '../components/shop/InsufficientTokensModal';
import PurchaseModal from '../components/shop/PurchaseModal';
import ShopItemCard from '../components/shop/ShopItemCard';
import TokenBadge from '../components/tokens/TokenBadge';
import { useShop } from '../hooks/useShop';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useTokenStore } from '../store/tokenStore';
import { useUiStore } from '../store/uiStore';

const ONE_TIME_TYPES = ['custom_badge', 'profile_badge', 'homepage_feature', 'username_change', 'battle_priority', 'nameplate_icon'];

export default function Shop() {
  const { user, profile, refreshProfile } = useAuthStore();
  const { refreshBalance } = useTokenStore();
  const [items, setItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [reviewRows, setReviewRows] = useState([]);
  const [closedBattles, setClosedBattles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [insufficient, setInsufficient] = useState(false);
  const [inlineMessage, setInlineMessage] = useState('');
  const { buy } = useShop();
  const addToast = useUiStore((s) => s.addToast);

  async function load() {
    if (!user || !supabase) return;
    const [itemRows, purchaseRows, queueRows, battleRows] = await Promise.all([
      supabase.from('shop_items').select('*').eq('is_active', true).order('cost_tokens'),
      supabase.from('user_shop_purchases').select('*, shop_items(name, cost_tokens, item_type)').eq('user_id', user.id).order('purchased_at', { ascending: false }),
      supabase.from('shop_review_queue').select('*').eq('user_id', user.id).order('purchased_at', { ascending: false }),
      supabase.from('battles').select('id, title').eq('status', 'closed').order('created_at', { ascending: false }),
    ]);
    setItems((itemRows.data || []).filter((item) => item.item_type !== 'extra_submission_slot'));
    setPurchases(purchaseRows.data || []);
    setReviewRows(queueRows.data || []);
    setClosedBattles(battleRows.data || []);
    refreshBalance(user.id);
  }

  useEffect(() => { load(); }, [user]);

  const ownedTypes = useMemo(() => {
    const purchased = purchases.map((row) => row.shop_items?.item_type).filter(Boolean);
    const approved = reviewRows.filter((row) => row.status === 'approved' || row.status === 'pending').map((row) => row.item_type);
    return new Set([...purchased, ...approved].filter((type) => ONE_TIME_TYPES.includes(type)));
  }, [purchases, reviewRows]);
  const ownedItemIds = useMemo(() => new Set(purchases.map((row) => row.item_id).filter(Boolean)), [purchases]);

  if (!profile) return <Navigate to="/login" replace />;

  async function confirm(metadata) {
    try {
      const result = await buy({ user, profile, item: selected, metadata });
      setInlineMessage(result.reviewed ? 'SUBMITTED FOR REVIEW - USUALLY APPROVED WITHIN 24H' : '');
      addToast(result.reviewed ? 'SUBMITTED FOR REVIEW' : 'PURCHASE COMPLETE');
      await refreshProfile();
      await load();
      setSelected(null);
    } catch (error) {
      addToast(error.message, 'error');
    }
  }

  return (
    <main className="rdb-container">
      <div className="flex items-center justify-between border-b border-rdb-border pb-3">
        <h1 className="font-mono text-[13px] uppercase text-rdb-orange">THE SHOP</h1>
        <span className="font-mono text-[11px] uppercase text-rdb-muted">YOUR BALANCE: <TokenBadge amount={profile.tokens} /></span>
      </div>
      {inlineMessage && <div className="mt-3 border border-rdb-orange p-2 font-mono text-[11px] uppercase text-rdb-orange">{inlineMessage}</div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {items.map((item) => (
          <ShopItemCard
            key={item.id}
            item={item}
            balance={profile.tokens}
            owned={['profile_accent', 'name_effect', 'name_color'].includes(item.item_type) ? ownedItemIds.has(item.id) : ownedTypes.has(item.item_type)}
            onBuy={(next) => profile.tokens < next.cost_tokens ? setInsufficient(true) : setSelected(next)}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Link className="rdb-button" to="/cosmetics"><Shirt size={14} />EQUIP COSMETICS</Link>
      </div>
      <section className="mt-6">
        <h2 className="rdb-section-title">PURCHASE HISTORY</h2>
        <div className="mt-2 overflow-x-auto border-t border-rdb-border">
          <table className="rdb-table min-w-[620px]">
            <tbody>
              {purchases.map((purchase) => (
                <tr className="h-9 border-b border-rdb-border" key={purchase.id}>
                  <td>{purchase.shop_items?.name || 'ITEM'}</td>
                  <td><TokenBadge amount={purchase.shop_items?.cost_tokens || 0} /></td>
                  <td>{new Date(purchase.purchased_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {reviewRows.map((row) => (
                <tr className="h-9 border-b border-rdb-border text-rdb-muted" key={row.id}>
                  <td>{row.item_type} REVIEW</td>
                  <td>{row.status}{row.admin_note ? ` - ${row.admin_note}` : ''}</td>
                  <td>{new Date(row.purchased_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {!purchases.length && !reviewRows.length && <tr><td className="h-9 text-rdb-muted">NO PURCHASES YET.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <PurchaseModal item={selected} open={Boolean(selected)} closedBattles={closedBattles} onCancel={() => setSelected(null)} onConfirm={confirm} />
      <InsufficientTokensModal open={insufficient} onClose={() => setInsufficient(false)} />
    </main>
  );
}
