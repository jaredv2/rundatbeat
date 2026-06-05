import { create } from 'zustand';

export const useBattleStore = create((set) => ({
  activeBattle: null,
  battles: [],
  submissions: [],
  setBattle: (activeBattle) => set({ activeBattle }),
  setBattles: (battles) => set({ battles }),
  setSubmissions: (submissions) => set({ submissions }),
}));
