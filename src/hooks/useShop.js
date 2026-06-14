import { supabase } from '../lib/supabase';
import { slugCosmeticName } from '../lib/display';
import { devLog, devError } from '../lib/devLog';

// These item types go to admin review before taking effect
const REVIEWED_TYPES = ['custom_badge', 'profile_badge', 'nameplate_icon'];

export function useShop() {
  async function buy({ user, profile, item, metadata }) {
    devLog('[useShop] buy() called — item:', item.name, 'item_type:', item.item_type, 'metadata:', metadata);

    if ((profile?.tokens || 0) < item.cost_tokens) {
      throw new Error('NOT ENOUGH RDB');
    }

    // 1. Deduct tokens
    const { error: txError } = await supabase.from('token_transactions').insert({
      user_id: user.id,
      amount: -item.cost_tokens,
      reason: 'shop_purchase',
    });
    if (txError) {
      devError('[useShop] token_transactions insert error:', txError);
      throw txError;
    }
    devLog('[useShop] Token transaction recorded — deducted:', item.cost_tokens);

    // 2. Record the purchase
    const { error: purchaseError } = await supabase.from('user_shop_purchases').insert({
      user_id: user.id,
      item_id: item.id,
      metadata,
    });
    if (purchaseError) {
      devError('[useShop] user_shop_purchases insert error:', purchaseError);
      throw purchaseError;
    }
    devLog('[useShop] Purchase recorded — item_id:', item.id);

    // 3. Items needing review → queue them and return early
    if (REVIEWED_TYPES.includes(item.item_type)) {
      const { error: queueError } = await supabase.from('shop_review_queue').insert({
        user_id: user.id,
        // profile_badge is stored as custom_badge in the review queue for consistency
        item_type: item.item_type === 'profile_badge' ? 'custom_badge' : item.item_type,
        item_data: metadata,
        status: 'pending',
      });
      if (queueError) {
        devError('[useShop] shop_review_queue insert error:', queueError);
        throw queueError;
      }
      devLog('[useShop] Queued for review — item_type:', item.item_type);
      return { reviewed: true };
    }

    // ── INSTANT-EFFECT ITEMS ──────────────────────────────────────────────

    if (item.item_type === 'username_change' && metadata?.value) {
      devLog('[useShop] Processing username_change →', metadata.value);
      const { error: historyError } = await supabase.from('username_history').insert({
        user_id: user.id,
        old_username: profile.username,
        new_username: metadata.value,
      });
      if (historyError) throw historyError;
      const { error: nameError } = await supabase.from('profiles').update({ username: metadata.value }).eq('id', user.id);
      if (nameError) throw nameError;
    }

    if (item.item_type === 'homepage_feature') {
      devLog('[useShop] Processing homepage_feature — featuring for 7 days');
      const featuredUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('profiles').update({ is_featured: true, featured_until: featuredUntil }).eq('id', user.id);
      if (error) throw error;
    }

    if (item.item_type === 'battle_priority') {
      devLog('[useShop] Processing battle_priority');
      const { error } = await supabase.from('profiles').update({ has_priority: true }).eq('id', user.id);
      if (error) throw error;
    }

    if (item.item_type === 'profile_accent' && metadata?.accent_color) {
      devLog('[useShop] Processing profile_accent →', metadata.accent_color);
      const { error } = await supabase.from('profiles').update({
        accent_color: metadata.accent_color,
        active_theme: metadata.theme || 'custom',
      }).eq('id', user.id);
      if (error) throw error;
    }

    if (item.item_type === 'name_effect') {
      const effect = metadata?.effect || slugCosmeticName(item.name);
      devLog('[useShop] Processing name_effect →', effect);
      const { error } = await supabase.from('profiles').update({ active_name_effect: effect }).eq('id', user.id);
      if (error) throw error;
    }

    if (item.item_type === 'name_color') {
      const color = metadata?.color || slugCosmeticName(item.name);
      devLog('[useShop] Processing name_color →', color);
      const { error } = await supabase.from('profiles').update({ active_name_color: color }).eq('id', user.id);
      if (error) throw error;
    }

    if (item.item_type === 'replay_access' && metadata?.battle_id) {
      devLog('[useShop] Processing replay_access — battle_id:', metadata.battle_id);
      const { error } = await supabase.from('user_replay_access').insert({
        user_id: user.id,
        battle_id: metadata.battle_id,
      });
      if (error) throw error;
    }

    devLog('[useShop] Purchase complete — no review needed');
    return { reviewed: false };
  }

  return { buy };
}