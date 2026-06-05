import { useTokenStore } from '../store/tokenStore';

export function useTokens(userId) {
  const store = useTokenStore();
  return {
    ...store,
    refresh: () => store.refreshBalance(userId),
  };
}
