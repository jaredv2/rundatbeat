import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './authStore';

export const useFriendStore = create((set, get) => ({
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  messagesByFriend: {},
  presence: {},
  selectedFriendId: null,
  unreadByFriend: {},

  setFriends: (friends) => set({ friends }),
  setIncomingRequests: (requests) => set({ incomingRequests: requests }),
  setOutgoingRequests: (requests) => set({ outgoingRequests: requests }),
  setSelectedFriendId: (id) => set({ selectedFriendId: id }),

  setPresence: (userId, lastSeenAt) =>
    set((s) => ({ presence: { ...s.presence, [userId]: lastSeenAt } })),

  setPresenceBatch: (entries) =>
    set((s) => {
      const next = { ...s.presence };
      for (const { user_id, last_seen_at } of entries) next[user_id] = last_seen_at;
      return { presence: next };
    }),

  setMessages: (friendId, msgs) =>
    set((s) => ({ messagesByFriend: { ...s.messagesByFriend, [friendId]: msgs } })),

  addMessage: (message) =>
    set((s) => {
      const profile = useAuthStore.getState().profile;
      const friendId = message.sender_id === profile?.id ? message.receiver_id : message.sender_id;
      const existing = s.messagesByFriend[friendId] || [];
      if (existing.some((m) => m.id === message.id)) return s;
      const isUnread = message.sender_id !== profile?.id && friendId !== s.selectedFriendId;
      return {
        messagesByFriend: { ...s.messagesByFriend, [friendId]: [...existing, message] },
        unreadByFriend: {
          ...s.unreadByFriend,
          [friendId]: (s.unreadByFriend[friendId] || 0) + (isUnread ? 1 : 0),
        },
      };
    }),

  clearUnread: (friendId) =>
    set((s) => ({ unreadByFriend: { ...s.unreadByFriend, [friendId]: 0 } })),

  removeMessage: (messageId) =>
    set((s) => {
      const next = { ...s.messagesByFriend };
      for (const k of Object.keys(next)) next[k] = next[k].filter((m) => m.id !== messageId);
      return { messagesByFriend: next };
    }),

  removeFriend: (friendId) =>
    set((s) => ({
      friends: s.friends.filter((f) => f.id !== friendId),
      incomingRequests: s.incomingRequests.filter((r) => r.id !== friendId),
      outgoingRequests: s.outgoingRequests.filter((r) => r.id !== friendId),
      selectedFriendId: s.selectedFriendId === friendId ? null : s.selectedFriendId,
    })),
}));
