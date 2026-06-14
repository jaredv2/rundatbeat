// Level curve: level N requires N * 100 XP total
// Level 1 = 0 XP, Level 2 = 100 XP, Level 3 = 300 XP, Level 4 = 600 XP ...
export function xpForLevel(level) {
  return (level - 1) * level * 50;
}

export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

// XP granted per placement
export const XP_REWARDS = {
  RANKED_WIN: 100,
  ROOM_WIN: 50,
  TOP_2: 30,
  TOP_3: 20,
  PARTICIPATION: 5,
};

export function computeXpGain({ rank, isRanked, isRoom }) {
  if (rank === 1) return isRanked ? XP_REWARDS.RANKED_WIN : XP_REWARDS.ROOM_WIN;
  if (rank === 2) return XP_REWARDS.TOP_2;
  if (rank === 3) return XP_REWARDS.TOP_3;
  return XP_REWARDS.PARTICIPATION;
}
