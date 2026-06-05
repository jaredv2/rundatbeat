import { supabase } from '../../lib/supabase';
import { useUiStore } from '../../store/uiStore';

export default function PremiumGate({ battle, profile, onPaid }) {
  const addToast = useUiStore((s) => s.addToast);
  const pay = async () => {
    if ((profile?.tokens || 0) < battle.entry_fee_tokens) {
      addToast('NOT ENOUGH RDB', 'error');
      return;
    }
    await supabase.from('token_transactions').insert({
      user_id: profile.id,
      amount: -battle.entry_fee_tokens,
      reason: 'premium_entry',
      battle_id: battle.id,
    });
    addToast('PREMIUM ENTRY PAID');
    onPaid?.();
  };
  return (
    <div className="rdb-panel p-6 text-center">
      <div className="font-mono text-2xl text-rdb-orange">LOCKED PREMIUM BATTLE</div>
      <button className="rdb-button rdb-button-primary mt-5" onClick={pay}>PAY {battle.entry_fee_tokens} RDB TO ENTER</button>
    </div>
  );
}
