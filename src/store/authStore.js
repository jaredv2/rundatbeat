import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  session: null,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setSession: (session) => set({ session, user: session?.user || null }),
  logout: async () => {
    if (supabase) await supabase.auth.signOut();
    set({ user: null, profile: null, session: null });
  },
  refreshProfile: async () => {
    const user = get().user;
    if (!user || !supabase) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    set({ profile: data });
    return data;
  },
}));
