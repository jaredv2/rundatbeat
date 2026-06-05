import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export const useTokenStore = create((set) => ({
  balance: 0,
  transactions: [],
  setBalance: (balance) => set({ balance }),
  refreshBalance: async (userId) => {
    if (!userId || !supabase) return;
    const [{ data: profile }, { data: transactions }] = await Promise.all([
      supabase.from('profiles').select('tokens').eq('id', userId).maybeSingle(),
      supabase.from('token_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);
    set({ balance: profile?.tokens || 0, transactions: transactions || [] });
  },
  addTransaction: (transaction) => set((state) => ({ transactions: [transaction, ...state.transactions] })),
}));
