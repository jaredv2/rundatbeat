import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { BadgeCheck, Shirt } from 'lucide-react';
import InsufficientTokensModal from '../components/shop/InsufficientTokensModal';
import PurchaseModal from '../components/shop/PurchaseModal';
import ShopItemCard from '../components/shop/ShopItemCard';
import TokenBadge from '../components/tokens/TokenBadge';
import { NAMEPLATE_ICONS } from '../lib/display';
import { useShop } from '../hooks/useShop';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useTokenStore } from '../store/tokenStore';
import { useUiStore } from '../store/uiStore';

const ONE_TIME_TYPES = ['custom_badge', 'profile_badge', 'homepage_feature', 'username_change', 'battle_priority', 'nameplate_icon'];

// Items that need extra input before going to PurchaseModal
const NEEDS_INLINE_PICKER = ['nameplate_icon', 'custom_badge', 'profile_badge'];

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

  // Inline picker state — shown when buying nameplate/badge before PurchaseModal
  const [pickerItem, setPickerItem] = useState(null);   // the shop item being configured
  const [pickerIcon, setPickerIcon] = useState(null);   // chosen NAMEPLATE_ICONS key
  const [pickerBadge, setPickerBadge] = useState('');   // typed badge text

  const { buy } = useShop();
  const addToast = useUiStore((s) => s.addToast);

  async function load() {
    if (!user || !supabase) return;
    console.log('[Shop] Loading shop data for user:', user.id);
    const [itemRows, purchaseRows, queueRows, battleRows] = await Promise.all([
      supabase.from('shop_items').select('*').eq('is_active', true).order('cost_tokens'),
      supabase.from('user_shop_purchases').select('*, shop_items(name, cost_tokens, item_type)').eq('user_id', user.id).order('purchased_at', { ascending: false }),
      supabase.from('shop_review_queue').select('*').eq('user_id', user.id).order('purchased_at', { ascending: false }),
      supabase.from('battles').select('id, title').eq('status', 'closed').order('created_at', { ascending: false }),
    ]);
    console.log('[Shop] Loaded items:', itemRows.data?.length, 'purchases:', purchaseRows.data?.length);
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

  // Called when user clicks BUY on a shop card
  function handleBuyClick(item) {
    if (profile.tokens < item.cost_tokens) {
      console.log('[Shop] Insufficient tokens for item:', item.name, '— needed:', item.cost_tokens, '— have:', profile.tokens);
      setInsufficient(true);
      return;
    }
    if (NEEDS_INLINE_PICKER.includes(item.item_type)) {
      // Show the inline picker first, then proceed to PurchaseModal
      console.log('[Shop] Opening inline picker for item_type:', item.item_type);
      setPickerItem(item);
      setPickerIcon(null);
      setPickerBadge('');
      return;
    }
    setSelected(item);
  }

  // Called when user confirms their picker choice and wants to proceed to PurchaseModal
  function handlePickerConfirm() {
    if (!pickerItem) return;
    const type = pickerItem.item_type;

    if ((type === 'nameplate_icon') && !pickerIcon) {
      addToast('SELECT AN ICON FIRST', 'error');
      return;
    }
    if ((type === 'custom_badge' || type === 'profile_badge') && !pickerBadge.trim()) {
      addToast('ENTER BADGE TEXT FIRST', 'error');
      return;
    }

    console.log('[Shop] Picker confirmed — type:', type, 'icon:', pickerIcon, 'badge:', pickerBadge);

    // Build the metadata that will be passed through PurchaseModal → confirm()
    const prefilledMetadata =
      type === 'nameplate_icon'
        ? { value: pickerIcon }
        : { value: pickerBadge.trim(), badge_text: pickerBadge.trim() };

    // Store prefilled metadata on the item so PurchaseModal/confirm() can use it
    setSelected({ ...pickerItem, _prefilledMetadata: prefilledMetadata });
    setPickerItem(null);
  }

  async function confirm(metadata) {
    try {
      // Merge any prefilled metadata (from inline picker) with what PurchaseModal sends
      const finalMetadata = selected?._prefilledMetadata
        ? { ...selected._prefilledMetadata, ...metadata }
        : metadata;

      console.log('[Shop] Confirming purchase — item:', selected?.name, 'metadata:', finalMetadata);
      const result = await buy({ user, profile, item: selected, metadata: finalMetadata });
      setInlineMessage(result.reviewed ? 'SUBMITTED FOR REVIEW - USUALLY APPROVED WITHIN 24H' : '');
      addToast(result.reviewed ? 'SUBMITTED FOR REVIEW' : 'PURCHASE COMPLETE');
      await refreshProfile();
      await load();
      setSelected(null);
    } catch (error) {
      console.error('[Shop] Purchase error:', error);
      addToast(error.message, 'error');
    }
  }

  const nameplateIconEntries = Object.entries(NAMEPLATE_ICONS);

  return (
    <main className="rdb-container">
      <div className="flex items-center justify-between border-b border-rdb-border pb-3">
        <h1 className="font-mono text-[13px] uppercase text-rdb-orange">THE SHOP</h1>
        <span className="font-mono text-[11px] uppercase text-rdb-muted">
          YOUR BALANCE: <TokenBadge amount={profile.tokens} />
        </span>
      </div>

      {inlineMessage && (
        <div className="mt-3 border border-rdb-orange p-2 font-mono text-[11px] uppercase text-rdb-orange">
          {inlineMessage}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {items.map((item) => (
          <ShopItemCard
            key={item.id}
            item={item}
            balance={profile.tokens}
            owned={
              ['profile_accent', 'name_effect', 'name_color'].includes(item.item_type)
                ? ownedItemIds.has(item.id)
                : ownedTypes.has(item.item_type)
            }
            onBuy={handleBuyClick}
          />
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Link className="rdb-button" to="/cosmetics"><Shirt size={14} />EQUIP COSMETICS</Link>
      </div>

      {/* ── INLINE PICKER PANEL ─────────────────────────────────────────── */}
      {pickerItem && (
        <section className="mt-6 border border-rdb-orange bg-rdb-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[13px] uppercase text-rdb-orange">
              {pickerItem.item_type === 'nameplate_icon' ? 'CHOOSE NAMEPLATE ICON' : 'SET BADGE TEXT'}
            </h2>
            <button
              className="rdb-button"
              type="button"
              onClick={() => {
                console.log('[Shop] Picker cancelled');
                setPickerItem(null);
              }}
            >
              CANCEL
            </button>
          </div>

          {/* ── NAMEPLATE ICON PICKER ── */}
          {pickerItem.item_type === 'nameplate_icon' && (
            <>
              <p className="mb-3 font-mono text-[11px] uppercase text-rdb-muted">
                SELECT AN ICON — THIS WILL APPEAR NEXT TO YOUR USERNAME
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {nameplateIconEntries.map(([key, emoji]) => {
                  console.log('[Shop] Rendering nameplate icon option:', key, emoji);
                  return (
                    <button
                      key={key}
                      type="button"
                      title={key}
                      className={`flex flex-col items-center gap-1 border p-3 font-mono text-[10px] uppercase transition-colors ${
                        pickerIcon === key
                          ? 'border-rdb-orange bg-rdb-orange/10 text-rdb-orange'
                          : 'border-rdb-border text-rdb-muted hover:border-rdb-orange/50'
                      }`}
                      onClick={() => {
                        console.log('[Shop] Icon selected:', key);
                        setPickerIcon(key);
                      }}
                    >
                      <span className="text-2xl">{emoji}</span>
                      <span>{key}</span>
                    </button>
                  );
                })}
              </div>

              {/* Live preview */}
              {pickerIcon && (
                <div className="mt-4 border border-rdb-border p-3">
                  <p className="mb-1 font-mono text-[10px] uppercase text-rdb-muted">PREVIEW</p>
                  <div className="flex items-center gap-2 font-mono text-sm uppercase text-rdb-text">
                    <span className="text-xl text-rdb-orange">{NAMEPLATE_ICONS[pickerIcon]}</span>
                    {profile.username}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── BADGE TEXT INPUT ── */}
          {(pickerItem.item_type === 'custom_badge' || pickerItem.item_type === 'profile_badge') && (
            <>
              <p className="mb-3 font-mono text-[11px] uppercase text-rdb-muted">
                ENTER YOUR CUSTOM BADGE TEXT — MAX 20 CHARACTERS — SUBMITTED FOR REVIEW
              </p>
              <div className="flex items-center gap-2">
                <input
                  className="rdb-input flex-1 uppercase"
                  type="text"
                  maxLength={20}
                  placeholder="E.G. BEAT LEGEND"
                  value={pickerBadge}
                  onChange={(e) => {
                    console.log('[Shop] Badge text input:', e.target.value);
                    setPickerBadge(e.target.value.toUpperCase());
                  }}
                />
                <span className="font-mono text-[10px] text-rdb-muted">
                  {pickerBadge.length}/20
                </span>
              </div>

              {/* Live preview */}
              {pickerBadge.trim() && (
                <div className="mt-4 border border-rdb-border p-3">
                  <p className="mb-1 font-mono text-[10px] uppercase text-rdb-muted">PREVIEW</p>
                  <span className="inline-flex items-center gap-1 border border-rdb-border px-2 py-1 font-mono text-xs text-rdb-muted">
                    <BadgeCheck size={12} />
                    {pickerBadge.trim()}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Confirm button — proceeds to PurchaseModal for final cost confirmation */}
          <div className="mt-4 flex justify-end">
            <button
              className="rdb-button rdb-button-primary"
              type="button"
              onClick={handlePickerConfirm}
            >
              CONTINUE TO PURCHASE →
            </button>
          </div>
        </section>
      )}
      {/* ── END INLINE PICKER ───────────────────────────────────────────── */}

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
              {!purchases.length && !reviewRows.length && (
                <tr><td className="h-9 text-rdb-muted">NO PURCHASES YET.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PurchaseModal
        item={selected}
        open={Boolean(selected)}
        closedBattles={closedBattles}
        onCancel={() => setSelected(null)}
        onConfirm={confirm}
      />
      <InsufficientTokensModal open={insufficient} onClose={() => setInsufficient(false)} />
    </main>
  );
}