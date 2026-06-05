import { supabase } from '../lib/supabase';
import { slugCosmeticName } from '../lib/display';

const REVIEWED_TYPES = ['custom_badge', 'profile_badge', 'nameplate_icon'];

export function useShop() {
  async function buy({ user, profile, item, metadata }) {
    if ((profile?.tokens || 0) < item.cost_tokens) throw new Error('NOT ENOUGH RDB');

    const { error: txError } = await supabase.from('token_transactions').insert({
      user_id: user.id,
      amount: -item.cost_tokens,
      reason: 'shop_purchase',
    });
    if (txError) throw txError;

    const { error: purchaseError } = await supabase.from('user_shop_purchases').insert({
      user_id: user.id,
      item_id: item.id,
      metadata,
    });
    if (purchaseError) throw purchaseError;

    if (REVIEWED_TYPES.includes(item.item_type)) {
      const { error: queueError } = await supabase.from('shop_review_queue').insert({
        user_id: user.id,
        item_type: item.item_type === 'profile_badge' ? 'custom_badge' : item.item_type,
        item_data: metadata,
        status: 'pending',
      });
      if (queueError) throw queueError;
      return { reviewed: true };
    }

    if (item.item_type === 'username_change' && metadata?.value) {
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
      const featuredUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('profiles').update({ is_featured: true, featured_until: featuredUntil }).eq('id', user.id);
      if (error) throw error;
    }
    if (item.item_type === 'battle_priority') {
      const { error } = await supabase.from('profiles').update({ has_priority: true }).eq('id', user.id);
      if (error) throw error;
    }
    if (item.item_type === 'profile_accent' && metadata?.accent_color) {
      const { error } = await supabase.from('profiles').update({ accent_color: metadata.accent_color, active_theme: metadata.theme || 'custom' }).eq('id', user.id);
      if (error) throw error;
    }
    if (item.item_type === 'name_effect') {
      const { error } = await supabase.from('profiles').update({ active_name_effect: metadata?.effect || slugCosmeticName(item.name) }).eq('id', user.id);
      if (error) throw error;
    }
    if (item.item_type === 'name_color') {
      const { error } = await supabase.from('profiles').update({ active_name_color: metadata?.color || slugCosmeticName(item.name) }).eq('id', user.id);
      if (error) throw error;
    }
    if (item.item_type === 'replay_access' && metadata?.battle_id) {
      const { error } = await supabase.from('user_replay_access').insert({
        user_id: user.id,
        battle_id: metadata.battle_id,
      });
      if (error) throw error;
    }
    return { reviewed: false };
  }
  return { buy };
}
