import { supabase } from './supabase';

export const TOKEN_REASONS = {
  battle_enter: 5,
  submission: 10,
  vote: 2,
  battle_win: 100,
  top3: 40,
  first_battle: 20,
  daily_login: 3,
};

export async function addTokenTransaction({ userId, amount, reason, battleId = null }) {
  const { error } = await supabase.from('token_transactions').insert({
    user_id: userId,
    amount,
    reason,
    battle_id: battleId,
  });
  if (error) throw error;
}

export async function grantDailyLogin(profile) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!profile || profile.last_login_reward === today) return false;
  await addTokenTransaction({ userId: profile.id, amount: 3, reason: 'daily_login' });
  const { error } = await supabase
    .from('profiles')
    .update({
      last_login_reward: today,
    })
    .eq('id', profile.id);
  if (error) throw error;
  return true;
}
