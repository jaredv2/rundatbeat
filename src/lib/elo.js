export const DEFAULT_ELO = 1000;

const K = 32;

const TIER_THRESHOLDS = [
  { elo: 2100, tier: 'goat' },
  { elo: 1800, tier: 'champion' },
  { elo: 1600, tier: 'elite' },
  { elo: 1400, tier: 'diamond' },
  { elo: 1250, tier: 'platinum' },
  { elo: 1100, tier: 'gold' },
  { elo: 900,  tier: 'silver' },
];

export function tierFromElo(elo) {
  for (const t of TIER_THRESHOLDS) {
    if (elo >= t.elo) return t.tier;
  }
  return 'bronze';
}

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function newElo(rating, expected, actual) {
  return Math.round(rating + K * (actual - expected));
}

export function computeNewElos(players, ranking) {
  const sorted = [...players].sort((a, b) => (ranking[a.user_id] ?? 99) - (ranking[b.user_id] ?? 99));
  const n = sorted.length;
  return sorted.map((p, i) => {
    const score = n - i; // 1st = 4, 2nd = 3, 3rd = 2, 4th = 1 (n=4)
    const maxScore = n - 1;
    const actual = maxScore > 0 ? score / maxScore : 0.5;
    const expected = sorted
      .filter((o) => o.user_id !== p.user_id)
      .reduce((sum, o) => sum + expectedScore(p.elo ?? DEFAULT_ELO, o.elo ?? DEFAULT_ELO), 0)
      / (n - 1);
    return { user_id: p.user_id, newElo: newElo(p.elo ?? DEFAULT_ELO, expected, actual), oldElo: p.elo ?? DEFAULT_ELO };
  });
}
